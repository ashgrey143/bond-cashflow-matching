"""Risk measures, what-if scenarios, strategy comparison and dashboard views
built on top of an optimised portfolio."""
from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from .bonds import pv, reprice, risk_from_cf
from .curve import Curve
from .optimizer import Options, node_matrix, optimise, prep_liabilities, simulate


# ------------------------------------------------------------------ risk

def portfolio_risk(hold: pd.DataFrame) -> dict:
    if hold.empty:
        return {"value": 0, "mod_dur": 0, "mac_dur": 0, "convexity": 0, "yield": 0}
    w = (hold["cost"] / hold["cost"].sum()).to_numpy()
    mod = float(w @ hold["mod_dur"].to_numpy())
    y = float(w @ hold["yield"].to_numpy())
    return {"value": float(hold["cost"].sum()), "mod_dur": mod, "mac_dur": mod * (1 + y / 200),
            "convexity": float(w @ hold["convexity"].to_numpy()), "yield": y}


def liability_risk(liab: pd.DataFrame, curve: Curve, settle, shift_bp=0.0, col="amount") -> dict:
    t = ((liab["date"] - settle).dt.days / 365).to_numpy()
    y = curve.zero_sa(t) + shift_bp / 1e4
    disc = (1 + y / 2) ** (-2 * t)
    amt = liab[col].to_numpy()
    v = amt * disc
    P = v.sum()
    if P <= 0:
        return {"pv": 0, "mod_dur": 0, "mac_dur": 0, "convexity": 0}
    return {"pv": float(P), "mac_dur": float((t * v).sum() / P),
            "mod_dur": float((t * v / (1 + y / 2)).sum() / P),
            "convexity": float((amt * t * (t + 0.5) * disc / (1 + y / 2) ** 2).sum() / P)}


def rate_shock_table(hold, bonds, cfs, liab, curve, settle, shifts=range(-200, 201, 25)) -> pd.DataFrame:
    """Market value of the portfolio and the liabilities under parallel shifts:
    full repricing compared with the duration and duration+convexity estimates."""
    risk = portfolio_risk(hold)
    sub = bonds[bonds["isin"].isin(hold["isin"])]
    units = hold.set_index("isin")["units"]
    v0 = float((hold["dirty"] * hold["units"]).sum())
    L0 = liability_risk(liab, curve, settle, col="required")["pv"]
    rows = []
    for bp in shifts:
        dy = bp / 1e4
        val = float((reprice(sub, cfs, bp) * units).sum()) if len(sub) else 0.0
        lpv = liability_risk(liab, curve, settle, bp, col="required")["pv"]
        rows.append({
            "shift_bp": bp, "portfolio_value": val,
            "change_pct": (val / v0 - 1) * 100 if v0 else 0,
            "duration_est_pct": -risk["mod_dur"] * dy * 100,
            "dur_conv_est_pct": (-risk["mod_dur"] * dy + 0.5 * risk["convexity"] * dy ** 2) * 100,
            "liability_pv": lpv, "liability_change_pct": (lpv / L0 - 1) * 100 if L0 else 0,
            "surplus": val - lpv,
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ views

def cash_calendar(hold, cfs_all, liab_sched, opts: Options, settle) -> tuple[pd.DataFrame, dict]:
    """Month-by-month inflows, payments and the cash balance waiting to be used."""
    last = liab_sched["date"].max()
    flows = []
    units = hold.set_index("isin")["units"] if len(hold) else pd.Series(dtype=float)
    for h in list(units.items()) + [(x["isin"], float(x.get("face") or 0) / 100) for x in opts.holdings or []]:
        isin, u = h
        cf = cfs_all[(cfs_all["isin"] == isin) & (cfs_all["date"] <= last)]
        flows += [{"date": d, "inflow": c * u, "isin": isin} for d, c in zip(cf["date"], cf["cf"])]
    inflow = pd.DataFrame(flows, columns=["date", "inflow", "isin"])
    months = pd.period_range(settle.to_period("M"), last.to_period("M"), freq="M")
    cal = pd.DataFrame({"month": months})
    cal["inflow"] = cal["month"].map(inflow.groupby(inflow["date"].dt.to_period("M"))["inflow"].sum()).fillna(0)
    cal["payment"] = cal["month"].map(liab_sched.groupby(liab_sched["date"].dt.to_period("M"))["paid"].sum()).fillna(0)
    bal, run = 0.0, []
    for i, o in zip(cal["inflow"], cal["payment"]):
        bal = max(0.0, bal + i - o)   # payments can also draw on reinvestment interest
        run.append(bal)
    cal["balance"] = run
    cal["month"] = cal["month"].astype(str)

    # how long each rupee waits between arriving and being paid out
    D = liab_sched["date"].values
    if len(inflow):
        node = np.searchsorted(D, inflow["date"].values, side="left")
        wait = (D[np.minimum(node, len(D) - 1)] - inflow["date"].values) / np.timedelta64(1, "D")
        avg_wait = float((wait * inflow["inflow"]).sum() / inflow["inflow"].sum())
    else:
        avg_wait = 0.0
    stats = {"avg_wait_days": avg_wait, "avg_idle_balance": float(cal["balance"].mean()),
             "max_idle_balance": float(cal["balance"].max())}
    return cal, stats


def sankey(hold, model, sched) -> dict:
    """Bonds -> payment dates, plus carry arcs between dates (the network)."""
    nodes, links = [], []
    dates = [f"{d:%d %b %Y}" for d in sched["date"]]
    for h in hold.itertuples():
        nodes.append({"name": h.description, "kind": "bond"})
    has_existing = sched["existing_cash"].sum() > 0
    if has_existing:
        nodes.append({"name": "Existing holdings", "kind": "bond"})
    base = len(nodes)
    for d in dates:
        nodes.append({"name": d, "kind": "date"})
    A = model.A
    for i, h in enumerate(hold.itertuples()):
        row = A.loc[h.isin].to_numpy() * h.units
        for t, v in enumerate(row):
            if v > 1:
                links.append({"source": i, "target": base + t, "value": float(v), "kind": "cash"})
    if has_existing:
        for t, v in enumerate(sched["existing_cash"]):
            if v > 1:
                links.append({"source": base - 1, "target": base + t, "value": float(v), "kind": "cash"})
    for t in range(len(dates) - 1):
        v = sched["carried_out"].iloc[t]
        if v > 1:
            links.append({"source": base + t, "target": base + t + 1, "value": float(v), "kind": "carry"})
    pay = len(nodes)
    nodes.append({"name": "Payments made", "kind": "sink"})
    for t in range(len(dates)):
        v = sched["paid"].iloc[t]
        if v > 1:
            links.append({"source": base + t, "target": pay, "value": float(v), "kind": "pay"})
    v = sched["carried_out"].iloc[-1]
    if v > 1:
        nodes.append({"name": "Cash left over", "kind": "sink"})
        links.append({"source": base + len(dates) - 1, "target": pay + 1, "value": float(v), "kind": "carry"})
    return {"nodes": nodes, "links": links}


# ------------------------------------------------------------------ scenarios

def _shift_prices(bonds, cfs, bp):
    out = bonds.copy()
    out["dirty"] = reprice(bonds, cfs, bp).reindex(bonds["isin"]).values
    out["yield"] = bonds["yield"] + bp / 100
    out["price"] = out["dirty"] - out["accrued"]
    groups = dict(tuple(cfs.groupby("isin")))
    risk = [risk_from_cf(groups[i]["t"].to_numpy(), groups[i]["cf"].to_numpy(), y / 100)
            for i, y in zip(out["isin"], out["yield"])]
    for k in ("mod_dur", "mac_dur", "convexity"):
        out[k] = [x[k] for x in risk]
    return out


def _scenario_row(name, desc, res, base_cost, extra=None):
    row = {"name": name, "description": desc, "status": res["status"]}
    if res["status"] in ("optimal", "shortfall"):
        risk = portfolio_risk(res["holdings"])
        row.update({
            "cost": res["cost"], "delta_cost": res["cost"] - base_cost,
            "delta_pct": (res["cost"] / base_cost - 1) * 100 if base_cost else 0,
            "bonds_used": len(res["holdings"]), "min_coverage": float(res["schedule"]["coverage"].min()),
            "mod_dur": risk["mod_dur"], "convexity": risk["convexity"],
            "units": res["holdings"].set_index("isin")["face"].to_dict(),
        })
    else:
        row["message"] = res.get("message", "")
    row.update(extra or {})
    return row


def scenarios(ctx, base: dict, custom: dict | None = None) -> list[dict]:
    bonds, cfs, liab, opts, settle = ctx["bonds"], ctx["cfs"], ctx["liabilities"], ctx["opts"], ctx["settle"]
    cfs_all = ctx["cfs_all"]
    base_cost = base["cost"]
    base_units = base["holdings"].set_index("isin")["units"]
    out = [_scenario_row("Base case", "Today's prices and your payment schedule", base, base_cost)]

    for bp in (50, -50):
        shifted = _shift_prices(bonds, cfs, bp)
        res = optimise(shifted, cfs, liab, opts, settle, cfs_all, duals=False)
        val = float((shifted.set_index("isin")["dirty"].reindex(base_units.index) * base_units).sum())
        out.append(_scenario_row(
            f"Rates {'+' if bp > 0 else '−'}0.5%", f"All yields {'rise' if bp > 0 else 'fall'} by 50 bp; re-optimised",
            res, base_cost, {"base_portfolio_value": val,
                             "base_value_change_pct": (val / base["portfolio_value_dirty"] - 1) * 100 if base["portfolio_value_dirty"] else 0.0,
                             "note": "Your base portfolio still pays every liability: its cash flows do not change."}))

    up = [{"date": l["date"], "amount": l["amount"] * 1.10} for l in liab]
    res = optimise(bonds, cfs, up, opts, settle, cfs_all, duals=False)
    sim = simulate(base_units, cfs_all, up, opts, settle)
    out.append(_scenario_row("Liabilities +10%", "Every payment 10% larger; re-optimised", res, base_cost,
                             {"base_portfolio_coverage": float(sim["coverage"].min()),
                              "base_portfolio_shortfall": float(sim["shortfall"].sum())}))

    early = [{"date": pd.Timestamp(l["date"]) - pd.Timedelta(days=91), "amount": l["amount"]} for l in liab]
    msg = _too_early(early, settle)
    res = {"status": "infeasible", "message": msg} if msg else optimise(bonds, cfs, early, opts, settle, cfs_all, duals=False)
    extra = {}
    if not msg:
        sim = simulate(base_units, cfs_all, early, opts, settle)
        extra = {"base_portfolio_coverage": float(sim["coverage"].min()),
                 "base_portfolio_shortfall": float(sim["shortfall"].sum())}
    out.append(_scenario_row("Payments 3 months earlier", "Each payment falls due 91 days sooner", res, base_cost, extra))

    if len(base["holdings"]):
        top = base["holdings"].sort_values("cost").iloc[-1]
        res = optimise(bonds[bonds["isin"] != top["isin"]], cfs, liab, opts, settle, cfs_all, duals=False)
        out.append(_scenario_row("Largest bond unavailable", f"{top['description']} removed; re-optimised",
                                 res, base_cost, {"removed": top["description"]}))

    if custom:
        out.append(custom_scenario(ctx, base, **custom))
    return out


def custom_scenario(ctx, base, rate_bp=0.0, liab_pct=0.0, shift_days=0, remove=None) -> dict:
    rate_bp, liab_pct, shift_days = float(rate_bp or 0), float(liab_pct or 0), int(shift_days or 0)
    bonds, cfs = ctx["bonds"], ctx["cfs"]
    if remove:
        bonds = bonds[~bonds["isin"].isin(remove)]
    if rate_bp:
        bonds = _shift_prices(bonds, cfs, rate_bp)
    liab = [{"date": pd.Timestamp(l["date"]) + pd.Timedelta(days=int(shift_days)),
             "amount": l["amount"] * (1 + liab_pct / 100)} for l in ctx["liabilities"]]
    parts = []
    if rate_bp:
        parts.append(f"rates {rate_bp:+g} bp")
    if liab_pct:
        parts.append(f"liabilities {liab_pct:+g}%")
    if shift_days:
        parts.append(f"payments {abs(shift_days)} days {'earlier' if shift_days < 0 else 'later'}")
    if remove:
        parts.append(f"{len(remove)} bond(s) unavailable")
    desc = ", ".join(parts) or "No change"
    too_early = _too_early(liab, ctx["settle"])
    if too_early:
        return {"name": "Custom scenario", "description": desc, "status": "infeasible", "message": too_early}

    res = optimise(bonds, cfs, liab, ctx["opts"], ctx["settle"], ctx["cfs_all"], duals=False)
    # today's plan, minus any bonds that are now unavailable
    base_units = base["holdings"].set_index("isin")["units"]
    if remove:
        base_units = base_units.drop(index=[i for i in remove if i in base_units.index])
    sim = simulate(base_units, ctx["cfs_all"], liab, ctx["opts"], ctx["settle"])
    row = _scenario_row("Custom scenario", desc, res, base["cost"],
                        {"base_portfolio_coverage": float(sim["coverage"].min()),
                         "base_portfolio_shortfall": float(sim["shortfall"].sum()),
                         "base_without_removed": bool(remove)})
    if res["status"] in ("optimal", "shortfall"):
        base_face = base["holdings"].set_index("isin")["face"]
        h = res["holdings"]
        row["holdings"] = [{
            **{k: x[k] for k in ("isin", "description", "maturity", "coupon", "face", "cost", "dirty", "yield", "weight")},
            "base_face": float(base_face.get(x["isin"], 0.0)),
        } for x in h.to_dict("records")]
        row["dropped"] = [{"isin": i, "description": base["holdings"].set_index("isin").loc[i, "description"],
                           "base_face": float(f)} for i, f in base_face.items() if i not in set(h["isin"])]
        row["schedule"] = [{"date": d, "required": q, "paid": p, "shortfall": u, "coverage": c}
                           for d, q, p, u, c in zip(res["schedule"]["date"], res["schedule"]["required"],
                                                     res["schedule"]["paid"], res["schedule"]["shortfall"],
                                                     res["schedule"]["coverage"])]
        row["message"] = res.get("message", "")
    return row


def _too_early(liab, settle) -> str:
    """Message if shifted payments fall on/before settlement (bonds bought now can't fund them)."""
    early = [l for l in liab if pd.Timestamp(l["date"]) <= settle]
    if not early:
        return ""
    first = min(pd.Timestamp(l["date"]) for l in early)
    return (f"{len(early)} payment(s) would fall due on or before settlement ({settle:%d %b %Y}), the first on "
            f"{first:%d %b %Y}. Bonds bought now can't pay them; shift the payments less.")


def uncertainty(ctx, base, factors=(0.8, 0.9, 1.0, 1.1, 1.2, 1.3)) -> list[dict]:
    """Cost to cover a larger/smaller schedule, and how the base portfolio copes."""
    base_units = base["holdings"].set_index("isin")["units"]
    rows = []
    for f in factors:
        liab = [{"date": l["date"], "amount": l["amount"] * f} for l in ctx["liabilities"]]
        res = optimise(ctx["bonds"], ctx["cfs"], liab, replace(ctx["opts"], budget=None), ctx["settle"],
                       ctx["cfs_all"], duals=False)
        sim = simulate(base_units, ctx["cfs_all"], liab, ctx["opts"], ctx["settle"])
        rows.append({"factor": f, "label": f"{(f - 1) * 100:+.0f}%" if f != 1 else "Base",
                     "cost": res.get("cost"), "status": res["status"],
                     "base_coverage": float(sim["coverage"].min()),
                     "base_shortfall": float(sim["shortfall"].sum()),
                     "liability_total": float(sum(l["amount"] for l in liab))})
    return rows


# ------------------------------------------------------------------ strategies

def manual_strategy(ctx) -> pd.Series:
    """What a person might do by hand: for each payment, latest first, buy the
    bond maturing closest before it until that payment is covered."""
    bonds, cfs_all, opts, settle = ctx["bonds"], ctx["cfs_all"], ctx["opts"], ctx["settle"]
    liab = prep_liabilities(ctx["liabilities"], settle)
    dates = liab["date"].reset_index(drop=True)
    A = node_matrix(ctx["cfs"], list(bonds["isin"]), dates, opts.reinvest_rate / 100)
    A = A[A.sum(axis=1) > 0]
    pool = bonds.set_index("isin").loc[A.index]
    units = pd.Series(0.0, index=A.index)
    for t in reversed(range(len(dates))):
        sim = simulate(units, cfs_all, ctx["liabilities"], opts, settle)
        gap = float(sim["shortfall"].iloc[t])
        if gap <= 1:
            continue
        before = pool[pool["maturity"] <= dates[t]]
        if len(before):
            best = before[before["maturity"] == before["maturity"].max()]
            isin = best["volume"].fillna(0).idxmax()
        else:
            ratio = A.iloc[:, : t + 1].sum(axis=1) / pool["dirty"]
            isin = ratio.idxmax()
        per_unit = A.loc[isin].iloc[: t + 1].sum()
        if per_unit > 0:
            units[isin] += gap / per_unit
    # buying for a later payment can leave cash that earlier payments use up first,
    # so keep topping up the earliest uncovered payment the same way
    for _ in range(200):
        sim = simulate(units, cfs_all, ctx["liabilities"], opts, settle)
        short = sim["shortfall"].to_numpy()
        if short.max() <= 1:
            break
        t = int(np.argmax(short > 1))
        before = pool[pool["maturity"] <= dates[t]]
        if len(before):
            isin = before[before["maturity"] == before["maturity"].max()]["volume"].fillna(0).idxmax()
        else:
            isin = (A.iloc[:, : t + 1].sum(axis=1) / pool["dirty"]).idxmax()
        units[isin] += short[t] / A.loc[isin].iloc[: t + 1].sum()
    return units[units > 0]


def duration_strategy(ctx, liab_risk: dict) -> pd.Series:
    """Classic immunisation: two liquid G-Secs bracketing the liabilities'
    duration, market value = PV of liabilities."""
    b = ctx["bonds"]
    b = b[(b["category"] != "SDL") & (b["volume"].fillna(0) > 0)]
    D, P = liab_risk["mod_dur"], liab_risk["pv"]
    lo, hi = b[b["mod_dur"] <= D], b[b["mod_dur"] >= D]
    if lo.empty or hi.empty:
        return pd.Series(dtype=float)
    s = lo.loc[(D - lo["mod_dur"]).nsmallest(3).index].sort_values("volume").iloc[-1]
    l = hi.loc[(hi["mod_dur"] - D).nsmallest(3).index].sort_values("volume").iloc[-1]
    if abs(l["mod_dur"] - s["mod_dur"]) < 1e-9:
        return pd.Series({s["isin"]: P / s["dirty"]})
    wl = (D - s["mod_dur"]) / (l["mod_dur"] - s["mod_dur"])
    return pd.Series({s["isin"]: (1 - wl) * P / s["dirty"], l["isin"]: wl * P / l["dirty"]})


def strategies(ctx, base, liab_risk) -> list[dict]:
    bonds = ctx["bonds"].set_index("isin")
    price = bonds["dirty"] * (1 + ctx["opts"].tx_cost_bp / 1e4)

    def describe(name, units: pd.Series, note):
        if units.empty:
            return {"name": name, "available": False, "note": note}
        sim = simulate(units, ctx["cfs_all"], ctx["liabilities"], ctx["opts"], ctx["settle"])
        cost = float((price.reindex(units.index) * units).sum())
        w = price.reindex(units.index) * units / cost
        return {"name": name, "available": True, "note": note, "cost": cost,
                "bonds_used": int((units > 0).sum()),
                "min_coverage": float(sim["coverage"].min()),
                "shortfall": float(sim["shortfall"].sum()),
                "leftover": float(sim["carried_out"].iloc[-1]),
                "mod_dur": float((w * bonds.loc[units.index, "mod_dur"]).sum()),
                "holdings": [{"isin": i, "description": bonds.loc[i, "description"], "face": float(u * 100)}
                             for i, u in units.items()]}

    out = [describe("Optimised (this model)", base["x"][base["x"] > 0],
                    "Lowest cost that pays every liability on time")]
    out.append(describe("Manual selection", manual_strategy(ctx),
                        "For each payment, buy the bond maturing just before it"))
    out.append(describe("Duration matching", duration_strategy(ctx, liab_risk),
                        "Two bonds whose duration equals the liabilities'; must sell bonds to pay"))
    return out


def constraint_costs(ctx) -> dict:
    """Cost of tightening policy limits."""
    out = {"max_weight": [], "min_volume": []}
    for w in (100, 50, 40, 30, 25, 20, 15, 10):
        res = optimise(ctx["bonds"], ctx["cfs"], ctx["liabilities"], replace(ctx["opts"], max_weight=w, budget=None),
                       ctx["settle"], ctx["cfs_all"], duals=False)
        out["max_weight"].append({"limit": w, "cost": res.get("cost") if res["status"] == "optimal" else None})
    for v in (0, 1, 5, 10, 25, 50, 100):
        b = ctx["bonds"][ctx["bonds"]["volume"].fillna(0) >= v]
        res = optimise(b, ctx["cfs"], ctx["liabilities"], replace(ctx["opts"], budget=None), ctx["settle"],
                       ctx["cfs_all"], duals=False)
        out["min_volume"].append({"limit": v, "bonds": int(len(b)),
                                  "cost": res.get("cost") if res["status"] == "optimal" else None})
    return out
