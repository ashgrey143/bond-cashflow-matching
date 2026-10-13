"""Datasets held in memory and the full analysis run behind the dashboard."""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd

from . import analytics as an
from . import bonds as bd
from . import ccil, curve as cv, data
from .optimizer import CRORE, Options, optimise, prep_liabilities, residual_value


@dataclass
class Dataset:
    id: str
    source: str            # sample | upload | ccil
    label: str
    bonds: pd.DataFrame    # one classified row per ISIN
    info: dict
    enriched: pd.DataFrame = field(default=None)
    cfs: pd.DataFrame = field(default=None)
    curve: cv.Curve = field(default=None)

    def __post_init__(self):
        settle = pd.Timestamp(self.info["settle"])
        ok = self.bonds[self.bonds["struct_reason"] == ""]
        self.enriched, self.cfs = bd.enrich(ok, settle)
        self.curve = cv.fit(self.enriched, self.cfs)

    @property
    def settle(self) -> pd.Timestamp:
        return pd.Timestamp(self.info["settle"])

    def summary(self) -> dict:
        b = self.bonds
        return {
            "id": self.id, "source": self.source, "label": self.label, **self.info,
            "usable": int((b["struct_reason"] == "").sum()),
            "by_category": {c: int(n) for c, n in b[b["struct_reason"] == ""]["category"].value_counts().items()},
            "price_check_max": float(np.nanmax(np.abs(self.enriched["price_check"]))) if len(self.enriched) else None,
            "curve_rmse_bp": self.curve.rmse_bp,
            "loaded_at": datetime.now().isoformat(timespec="seconds"),
        }


DATASETS: dict[str, Dataset] = {}


def _register(source, label, raw) -> Dataset:
    bonds, info = data.clean(raw)
    if (bonds["struct_reason"] == "").sum() == 0:
        raise ValueError("The file has no fixed-coupon securities that can be used")
    ds = Dataset(uuid.uuid4().hex[:10], source, label, bonds, info)
    DATASETS[ds.id] = ds
    return ds


def load_sample() -> Dataset:
    for ds in DATASETS.values():
        if ds.source == "sample":
            return ds
    return _register("sample", "Sample: CCIL Trading Platform, 19–20 Aug 2026", data.read_any(data.SAMPLE_FILE))


def load_upload(content: bytes, filename: str) -> Dataset:
    return _register("upload", f"Uploaded: {filename}", data.read_any(content, filename))


def load_ccil(use_cache_on_error: bool = True) -> tuple[Dataset, str | None]:
    try:
        payload, path = ccil.fetch_latest()
        note = None
    except ccil.CCILError as e:
        path = ccil.latest_cache() if use_cache_on_error else None
        if not path:
            raise
        payload, note = path.read_text(), f"{e}. Using the last download ({path.stem[5:]})."
    raw = data.normalise(data.read_ccil_json(payload))
    ds = _register("ccil", "Live: CCIL Trading Platform (latest trading days)", raw)
    return ds, note


# ------------------------------------------------------------------ JSON helpers

def _clean(v):
    if isinstance(v, (pd.Timestamp, datetime)):
        return None if pd.isna(v) else v.strftime("%Y-%m-%d")
    if isinstance(v, np.datetime64):
        return None if np.isnat(v) else pd.Timestamp(v).strftime("%Y-%m-%d")
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        return None if (math.isnan(v) or math.isinf(v)) else float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if v is pd.NaT:
        return None
    return v


def records(df: pd.DataFrame | None) -> list[dict]:
    if df is None or len(df) == 0:
        return []
    return [_clean(r) for r in df.to_dict("records")]


UNIVERSE_COLS = ["isin", "description", "category", "kind", "coupon", "maturity", "price", "accrued",
                 "dirty", "ytm", "yield", "mod_dur", "convexity", "years", "volume", "trades", "date",
                 "stale_days", "price_check"]


# ------------------------------------------------------------------ main run

def run(ds: Dataset, liabilities: list[dict], options: dict | None = None,
        filters: dict | None = None, custom: dict | None = None, full: bool = True) -> dict:
    opts = Options.from_dict(options)
    settle = ds.settle
    el, ex = data.universe(ds.bonds, filters)
    eb = ds.enriched[ds.enriched["isin"].isin(el["isin"])].reset_index(drop=True)
    cfs = ds.cfs[ds.cfs["isin"].isin(eb["isin"])]
    warnings = []

    liab_in = pd.DataFrame(liabilities or [], columns=["date", "amount"])
    liab = prep_liabilities(liab_in, settle)
    dropped = len(liab_in.dropna()) - len(liab)
    if dropped > 0:
        warnings.append(f"{dropped} payment(s) on or before settlement ({settle:%d-%b-%Y}) or with no amount were ignored.")
    liab_list = [{"date": d, "amount": a} for d, a in zip(liab["date"], liab["amount"])]

    t_grid = np.linspace(0.1, max(1.0, float(ds.enriched["years"].max())), 80)
    curve_view = {
        "points": records(eb[["isin", "description", "category", "years", "ytm", "yield", "volume"]]),
        "fitted": [{"years": float(t), "rate": float(r * 100)} for t, r in zip(t_grid, ds.curve.zero_sa(t_grid))],
        "rmse_bp": ds.curve.rmse_bp, "params": list(ds.curve.params),
    }
    out = {
        "dataset": ds.summary(), "settle": settle.strftime("%Y-%m-%d"),
        "universe": records(eb[UNIVERSE_COLS]),
        "excluded": records(ex[["isin", "description", "category", "maturity", "price", "volume", "reason"]]),
        "curve": curve_view, "liabilities": records(liab), "options": _clean(opts.__dict__),
    }

    res = optimise(eb, cfs, liab_list, opts, settle, ds.cfs)
    out["status"], out["message"] = res["status"], res.get("message", "")
    if res["status"] == "infeasible":
        out["warnings"] = warnings
        return out

    m, hold, sched = res["model"], res["holdings"], res["schedule"]
    if m.missing_holdings:
        warnings.append(f"Existing holdings not found in the data and ignored: {', '.join(m.missing_holdings)}.")
    if m.integer:
        warnings.append("Whole lots are on: shadow prices are taken from the fractional (LP) version of the model.")
    n_illiq = int((hold["liquidity"] == "Illiquid").sum())
    if n_illiq:
        warnings.append(f"{n_illiq} selected bond(s) need more than the whole day's traded volume.")

    res["portfolio_value_dirty"] = float((hold["dirty"] * hold["units"]).sum())
    prisk = an.portfolio_risk(hold)
    lrisk = an.liability_risk(sched, ds.curve, settle, col="required")
    cal, cal_stats = an.cash_calendar(hold, ds.cfs, sched, opts, settle)
    resid = residual_value(hold, ds.cfs, eb, sched["date"].max())

    out.update({
        "holdings": records(hold), "schedule": records(sched),
        "duals": records(res.get("duals")), "reduced": records(res.get("reduced")),
        "risk": {"portfolio": prisk, "liabilities": lrisk},
        "shock": records(an.rate_shock_table(hold, eb, cfs, sched, ds.curve, settle)),
        "calendar": records(cal), "sankey": an.sankey(hold, m, sched),
        "matrix": {"dates": [d.strftime("%Y-%m-%d") for d in m.dates],
                   "rows": [{"isin": i, "description": hold.set_index("isin").loc[i, "description"],
                             "cf": [float(v) for v in m.A.loc[i].to_numpy()]} for i in hold["isin"]]},
    })

    summary = {
        "covered_all": res["status"] == "optimal" and float(sched["coverage"].min()) >= 0.9999,
        "cost": res["cost"], "liability_total": float(sched["liability"].sum()),
        "required_total": float(sched["required"].sum()), "liability_pv": lrisk["pv"],
        "payments": int(len(sched)), "bonds_used": int(len(hold)),
        "min_coverage": float(sched["coverage"].min()), "shortfall": float(sched["shortfall"].sum()),
        "leftover_cash": float(sched["carried_out"].iloc[-1]), "residual_value": resid,
        "portfolio_mod_dur": prisk["mod_dur"], "liability_mod_dur": lrisk["mod_dur"],
        "portfolio_convexity": prisk["convexity"], "liability_convexity": lrisk["convexity"],
        "portfolio_yield": prisk["yield"], "avg_wait_days": cal_stats["avg_wait_days"],
        "avg_idle_balance": cal_stats["avg_idle_balance"], "max_idle_balance": cal_stats["max_idle_balance"],
        "first_payment": sched["date"].min().strftime("%Y-%m-%d"),
        "last_payment": sched["date"].max().strftime("%Y-%m-%d"),
        "eligible_bonds": int(len(eb)), "illiquid": n_illiq,
        "watch": int((hold["liquidity"] == "Watch").sum()),
        "data_date": ds.info["last_trade_date"],
    }
    out["warnings"] = warnings

    if full:
        ctx = {"bonds": eb, "cfs": cfs, "cfs_all": ds.cfs, "liabilities": liab_list, "opts": opts, "settle": settle}
        strat = an.strategies(ctx, res, lrisk) if res["status"] == "optimal" else []
        manual = next((s for s in strat if s["name"] == "Manual selection" and s.get("available")), None)
        if manual:
            summary["manual_cost"] = manual["cost"]
            summary["savings_vs_manual"] = manual["cost"] - res["cost"]
            summary["savings_pct"] = (manual["cost"] / res["cost"] - 1) * 100 if res["cost"] else 0
        out.update({
            "scenarios": _clean(an.scenarios(ctx, res, custom)) if res["status"] == "optimal" else [],
            "uncertainty": _clean(an.uncertainty(ctx, res)) if res["status"] == "optimal" else [],
            "strategies": _clean(strat),
            "constraints": _clean(an.constraint_costs(ctx)) if res["status"] == "optimal" else {},
        })
    out["summary"] = _clean(summary)
    out["risk"] = _clean(out["risk"])
    return out


def run_custom(ds: Dataset, liabilities, options, filters, custom: dict) -> dict:
    opts = Options.from_dict(options)
    el, _ = data.universe(ds.bonds, filters)
    eb = ds.enriched[ds.enriched["isin"].isin(el["isin"])].reset_index(drop=True)
    cfs = ds.cfs[ds.cfs["isin"].isin(eb["isin"])]
    liab = prep_liabilities(pd.DataFrame(liabilities, columns=["date", "amount"]), ds.settle)
    liab_list = [{"date": d, "amount": a} for d, a in zip(liab["date"], liab["amount"])]
    base = optimise(eb, cfs, liab_list, opts, ds.settle, ds.cfs, duals=False)
    if base["status"] != "optimal":
        return {"status": base["status"], "message": base.get("message", "")}
    base["portfolio_value_dirty"] = float((base["holdings"]["dirty"] * base["holdings"]["units"]).sum())
    ctx = {"bonds": eb, "cfs": cfs, "cfs_all": ds.cfs, "liabilities": liab_list, "opts": opts, "settle": ds.settle}
    return _clean(an.custom_scenario(ctx, base, **custom))


def default_liabilities(settle: pd.Timestamp, n: int = 5) -> list[dict]:
    """Five yearly payments on 31 March, rising from Rs 1.0 cr to Rs 1.8 cr."""
    first = pd.Timestamp(year=settle.year + (settle.month > 3 or (settle.month == 3 and settle.day >= 31)),
                         month=3, day=31)
    if (first - settle).days < 60:
        first = first + pd.DateOffset(years=1)
    amounts = [1.0, 1.2, 1.4, 1.5, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8][:n]
    return [{"date": (first + pd.DateOffset(years=k)).strftime("%Y-%m-%d"), "amount": a * CRORE}
            for k, a in enumerate(amounts)]
