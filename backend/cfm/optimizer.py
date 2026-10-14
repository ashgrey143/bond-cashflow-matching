"""Network optimisation model for bond cash-flow matching.

Network: one node per liability date t = 1..T. Every bond cash flow paid
after date t-1 and up to date t flows into node t (earning the reinvestment
rate r until t). Cash left after paying L_t flows along a carry arc to node
t+1. With x_i = units of bond i (Rs 100 face each) and s_t = cash carried:

    minimise    sum_i P_i x_i
    subject to  sum_i CF_it x_i + g_t s_{t-1} - s_t + u_t = m L_t - E_t     (flow balance, each t)
                P_i x_i <= w * sum_j P_j x_j                                 (optional per-bond limit)
                0 <= x_i <= cap_i                                            (optional volume cap)
                x_i in lot multiples                                         (optional whole lots)

P_i is the dirty price plus transaction cost, g_t = (1+r)^(years between
dates), m the safety margin, E_t cash from bonds already held, and u_t a
shortfall that is only allowed when a budget is too small to cover everything
(the model then covers as much as it can, earliest payments first).
"""
from __future__ import annotations

from dataclasses import dataclass, field, fields

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, linprog, milp

from .bonds import pv

CRORE = 1e7


@dataclass
class Options:
    reinvest_rate: float = 0.0     # % p.a. earned on cash waiting for a payment
    safety_margin: float = 100.0   # % of each liability to cover
    budget: float | None = None    # Rs; None = no limit
    max_weight: float = 100.0      # % of total cost in any one bond
    lot_face: float = 0.0          # Rs face value per lot; 0 = fractional units
    max_volume_pct: float = 0.0    # max order as % of the day's traded volume; 0 = off
    tx_cost_bp: float = 0.0        # cost on top of the dirty price
    holdings: list = field(default_factory=list)  # [{"isin":..., "face": Rs}]

    @classmethod
    def from_dict(cls, d: dict | None) -> "Options":
        names = {f.name for f in fields(cls)}
        d = {k: v for k, v in (d or {}).items() if k in names and v is not None}
        if d.get("budget") in (0, "", None):
            d.pop("budget", None)
        return cls(**d)


def prep_liabilities(liabilities, settle: pd.Timestamp) -> pd.DataFrame:
    liab = pd.DataFrame(liabilities)
    if liab.empty:
        return pd.DataFrame(columns=["date", "amount"])
    liab["date"] = pd.to_datetime(liab["date"])
    liab["amount"] = pd.to_numeric(liab["amount"], errors="coerce")
    liab = liab.dropna()
    liab = liab[(liab["amount"] > 0) & (liab["date"] > settle)]
    return liab.groupby("date", as_index=False)["amount"].sum().sort_values("date").reset_index(drop=True)


def node_matrix(cfs: pd.DataFrame, isins, dates: pd.Series, r: float) -> pd.DataFrame:
    """CF_it: cash per unit from bond i reaching node t (with reinvestment)."""
    isins = list(isins)
    D = dates.values
    out = np.zeros((len(isins), len(D)))
    cf = cfs[cfs["isin"].isin(isins)]
    node = np.searchsorted(D, cf["date"].values, side="left")
    ok = node < len(D)
    if ok.any():
        row = pd.Index(isins).get_indexer(cf["isin"].values[ok])
        wait = (D[node[ok]] - cf["date"].values[ok]) / np.timedelta64(1, "D") / 365
        np.add.at(out, (row, node[ok]), cf["cf"].to_numpy()[ok] * (1 + r) ** wait)
    return pd.DataFrame(out, index=pd.Index(isins, name="isin"), columns=range(len(D)))


def carry_growth(dates: pd.Series, r: float) -> np.ndarray:
    gaps = np.diff(dates.values) / np.timedelta64(1, "D") / 365
    return np.concatenate([[0.0], (1 + r) ** gaps])


def existing_cash(holdings, cfs_all: pd.DataFrame, dates, r) -> tuple[np.ndarray, list]:
    """Node cash from bonds already held, and ISINs we could not value."""
    E, missing = np.zeros(len(dates)), []
    for h in holdings or []:
        isin, face = str(h.get("isin", "")).strip(), float(h.get("face") or 0)
        if not isin or face <= 0:
            continue
        if isin not in set(cfs_all["isin"]):
            missing.append(isin)
            continue
        E += node_matrix(cfs_all, [isin], dates, r).iloc[0].to_numpy() * face / 100
    return E, missing


def _solve(c, A_eq, b_eq, A_ub, b_ub, bounds, integrality=None):
    if integrality is not None and integrality.any():
        cons = [LinearConstraint(A_eq, b_eq, b_eq)]
        if A_ub is not None:
            cons.append(LinearConstraint(A_ub, -np.inf, b_ub))
        lb = np.array([b[0] for b in bounds], float)
        ub = np.array([np.inf if b[1] is None else b[1] for b in bounds], float)
        res = milp(c, constraints=cons, integrality=integrality, bounds=Bounds(lb, ub),
                   options={"time_limit": 15, "mip_rel_gap": 1e-4})
        return (res.x if res.status in (0, 1) and res.x is not None else None), None
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
    return (res.x if res.status == 0 else None), (res if res.status == 0 else None)


class Model:
    """The LP for one universe of bonds and one liability schedule."""

    def __init__(self, bonds: pd.DataFrame, cfs: pd.DataFrame, liab: pd.DataFrame,
                 opts: Options, cfs_all: pd.DataFrame | None = None):
        self.opts, self.liab = opts, liab
        self.dates = liab["date"].reset_index(drop=True)
        r = opts.reinvest_rate / 100
        A = node_matrix(cfs, list(bonds["isin"]), self.dates, r)
        self.useless = list(A.index[A.sum(axis=1) <= 0])
        A = A[A.sum(axis=1) > 0]
        self.A = A
        self.bonds = bonds.set_index("isin").loc[A.index].reset_index()
        self.price = self.bonds["dirty"].to_numpy() * (1 + opts.tx_cost_bp / 1e4)
        self.g = carry_growth(self.dates, r)
        self.E, self.missing_holdings = existing_cash(
            opts.holdings, cfs_all if cfs_all is not None else cfs, self.dates, r)
        self.required = liab["amount"].to_numpy() * opts.safety_margin / 100
        self.b = self.required - self.E
        self.n, self.T = len(A), len(self.dates)
        self.k = opts.lot_face / 100 if opts.lot_face and opts.lot_face > 0 else 1.0
        self.integer = opts.lot_face and opts.lot_face > 0

    # -- matrices (variables: x in lots/units, s, u)
    def _system(self, shortfall: bool, use_caps=True, use_weight=True, budget=None):
        n, T, k = self.n, self.T, self.k
        A_eq = np.zeros((T, n + 2 * T))
        A_eq[:, :n] = self.A.to_numpy().T * k
        for t in range(T):
            A_eq[t, n + t] = -1.0
            if t > 0:
                A_eq[t, n + t - 1] = self.g[t]
            A_eq[t, n + T + t] = 1.0
        rows, rhs = [], []
        cost = self.price * k
        w = self.opts.max_weight / 100
        if use_weight and w < 1 and n > 0:
            for i in range(n):
                row = np.zeros(n + 2 * T)
                row[:n] = -w * cost
                row[i] += cost[i]
                rows.append(row); rhs.append(0.0)
        if budget is not None:
            row = np.zeros(n + 2 * T); row[:n] = cost
            rows.append(row); rhs.append(budget)
        A_ub = np.array(rows) if rows else None
        b_ub = np.array(rhs) if rows else None
        caps = [None] * n
        if use_caps and self.opts.max_volume_pct > 0:
            vol = self.bonds["volume"].fillna(0).to_numpy() * CRORE
            caps = list(vol * self.opts.max_volume_pct / 100 / 100 / k)
        bounds = [(0, c) for c in caps] + [(0, None)] * T + [(0, None if shortfall else 0)] * T
        integ = np.zeros(n + 2 * T)
        if self.integer:
            integ[:n] = 1
        return A_eq, A_ub, b_ub, bounds, integ, cost

    def solve_min_cost(self, use_caps=True, use_weight=True, relax=False):
        A_eq, A_ub, b_ub, bounds, integ, cost = self._system(False, use_caps, use_weight)
        c = np.concatenate([cost, np.zeros(2 * self.T)])
        return _solve(c, A_eq, self.b, A_ub, b_ub, bounds, None if relax else integ)

    def solve_budget(self, budget: float | None):
        """Cover as much as possible within budget: earliest payments first."""
        A_eq, A_ub, b_ub, bounds, integ, cost = self._system(True, budget=budget)
        T, n = self.T, self.n
        # a rupee short earlier counts 25% more per year than one short later; that
        # beats any discounting, so the earliest payments are protected first
        years_left = (self.dates.iloc[-1] - self.dates).dt.days.to_numpy() / 365
        wts = 1.25 ** years_left
        c1 = np.concatenate([np.zeros(n + T), wts])
        z, _ = _solve(c1, A_eq, self.b, A_ub, b_ub, bounds, integ)
        if z is None:
            return None
        short = float(wts @ z[n + T:])
        row = np.zeros(n + 2 * T); row[n + T:] = wts
        A_ub2 = row[None, :] if A_ub is None else np.vstack([A_ub, row])
        b_ub2 = np.array([short * (1 + 1e-9) + 1e-6]) if b_ub is None else np.append(b_ub, short * (1 + 1e-9) + 1e-6)
        c2 = np.concatenate([cost, np.zeros(2 * T)])
        z2, _ = _solve(c2, A_eq, self.b, A_ub2, b_ub2, bounds, integ)
        return z2 if z2 is not None else z

    # -- diagnosis when no feasible portfolio exists
    def diagnose(self) -> str:
        if self.n == 0:
            first = self.dates.iloc[0].date() if self.T else None
            return ("No eligible bond pays any cash on or before the final payment date. "
                    "Loosen the bond filters or check the liability dates.") if first else "No liabilities."
        A = self.A.to_numpy()
        first_pay = np.argmax(A.sum(axis=0) > 0)
        need = np.nonzero(self.b > 1e-6)[0]
        if len(need) and need[0] < first_pay:
            t = need[0]
            return (f"No eligible bond pays anything on or before {self.dates[t].date():%d-%b-%Y} "
                    f"(payment {t + 1}). The earliest bond cash reaches payment {first_pay + 1} "
                    f"({self.dates[first_pay].date():%d-%b-%Y}). Include T-Bills, hold cash for the early "
                    f"payment, or move it later.")
        if self.opts.max_volume_pct > 0 and self.solve_min_cost(use_caps=False, relax=True)[0] is not None:
            return (f"The volume cap ({self.opts.max_volume_pct:g}% of each bond's traded volume) "
                    "leaves too little bond supply. Raise the cap or switch it off.")
        if self.opts.max_weight < 100 and self.solve_min_cost(use_weight=False, relax=True)[0] is not None:
            return (f"The {self.opts.max_weight:g}% per-bond limit cannot be met: too few bonds pay "
                    "cash in the early periods. Raise the limit.")
        return "No portfolio can meet these payments with the selected bonds."


def optimise(bonds: pd.DataFrame, cfs: pd.DataFrame, liabilities, opts: Options,
             settle: pd.Timestamp, cfs_all: pd.DataFrame | None = None, duals: bool = True) -> dict:
    liab = prep_liabilities(liabilities, settle)
    if liab.empty:
        return {"status": "infeasible", "message": "Add at least one payment after the settlement date "
                f"({settle.date():%d-%b-%Y})."}
    m = Model(bonds, cfs, liab, opts, cfs_all)
    m.settle = settle
    z, lp = m.solve_min_cost()
    status, message = "optimal", ""
    if z is not None and opts.budget is not None and float(m.price * m.k @ z[:m.n]) > opts.budget * (1 + 1e-9):
        z = m.solve_budget(opts.budget)
        status = "shortfall"
        message = f"The budget of Rs {opts.budget / CRORE:,.2f} cr is not enough to cover every payment."
    elif z is None:
        diag = m.diagnose()
        z = m.solve_budget(opts.budget)  # cover what can be covered
        if z is None:
            return {"status": "infeasible", "message": diag, "model": m}
        status, message = "shortfall", diag
    if z is None:
        return {"status": "infeasible", "message": "The budget is too small to buy any bonds.", "model": m}

    res = _package(m, z, status, message)
    if duals and status == "optimal":
        _, lp_relaxed = (None, lp) if lp is not None else m.solve_min_cost(relax=True)
        if lp_relaxed is not None:
            res.update(_duals(m, lp_relaxed))
    return res


def _package(m: Model, z: np.ndarray, status: str, message: str) -> dict:
    n, T, k = m.n, m.T, m.k
    x = z[:n] * k
    s, u = z[n:n + T], z[n + T:]
    x[x < 1e-7] = 0
    u = np.where(u < 0.5, 0.0, u)
    bond_cash = m.A.to_numpy().T @ x
    carried_in = np.concatenate([[0.0], m.g[1:] * s[:-1]])
    sched = pd.DataFrame({
        "date": m.dates, "liability": m.liab["amount"].to_numpy(), "required": m.required,
        "existing_cash": m.E, "bond_cash": bond_cash, "carried_in": carried_in,
        "shortfall": u, "paid": m.required - u, "carried_out": s,
    })
    sched["coverage"] = np.where(sched["required"] > 0, sched["paid"] / sched["required"], 1.0)
    sel = x > 0
    b = m.bonds[sel].copy()
    units = x[sel]
    hold = pd.DataFrame({
        "isin": b["isin"].values, "description": b["description"].values,
        "category": b["category"].values, "coupon": b["coupon"].values,
        "maturity": b["maturity"].values, "units": units, "face": units * 100,
        "lots": units / k if m.integer else np.nan,
        "clean": b["price"].values, "accrued": b["accrued"].values, "dirty": b["dirty"].values,
        "unit_cost": m.price[sel], "cost": units * m.price[sel],
        "yield": b["yield"].values, "ccil_ytm": b["ytm"].values,
        "mod_dur": b["mod_dur"].values, "convexity": b["convexity"].values,
        "volume": b["volume"].values, "trades": b["trades"].values,
        "last_trade": b["date"].values, "stale_days": b["stale_days"].values,
    })
    total = hold["cost"].sum()
    hold["weight"] = hold["cost"] / total if total > 0 else 0
    hold["order_pct_volume"] = np.where(hold["volume"] > 0, hold["face"] / (hold["volume"] * CRORE) * 100, np.inf)
    hold["liquidity"] = np.select(
        [hold["order_pct_volume"] > 100, (hold["order_pct_volume"] > 25) | (hold["trades"].fillna(0) <= 2)],
        ["Illiquid", "Watch"], "OK")
    hold = hold.sort_values("maturity").reset_index(drop=True)
    return {"status": status, "message": message, "cost": float(total), "x": pd.Series(x, index=m.A.index),
            "holdings": hold, "schedule": sched, "model": m}


def _duals(m: Model, lp) -> dict:
    """Shadow prices: cost today of one more rupee needed at each date, and
    how much cheaper each unused bond would have to be to enter."""
    n = m.n
    pi = np.asarray(lp.eqlin.marginals)
    settle_years = np.array([(d - m.settle).days / 365 for d in m.dates])
    ok = (pi > 0) & (settle_years > 0)   # a zero shadow price (date already funded) has no implied rate
    implied = np.full(len(pi), np.nan)
    implied[ok] = pi[ok] ** (-1 / settle_years[ok]) - 1
    dual = pd.DataFrame({"date": m.dates, "shadow_price": pi, "implied_rate": implied * 100,
                         "years": settle_years})
    rc = np.asarray(lp.lower.marginals)[:n] / m.k
    x = lp.x[:n]
    unused = pd.DataFrame({
        "isin": m.bonds["isin"], "description": m.bonds["description"], "maturity": m.bonds["maturity"],
        "dirty": m.bonds["dirty"], "yield": m.bonds["yield"],
        "reduced_cost": rc, "needed_drop_pct": rc / m.price * 100, "selected": x > 1e-7,
    })
    # value per rupee of price: cash delivered (valued at shadow prices) / price
    unused["value_ratio"] = (m.A.to_numpy() @ pi) / m.price
    return {"duals": dual, "reduced": unused.sort_values("reduced_cost").reset_index(drop=True)}


def simulate(units: pd.Series, cfs_all: pd.DataFrame, liabilities, opts: Options,
             settle: pd.Timestamp) -> pd.DataFrame:
    """Run fixed holdings (units by ISIN) against a liability schedule with carry."""
    liab = prep_liabilities(liabilities, settle)
    dates = liab["date"].reset_index(drop=True)
    r = opts.reinvest_rate / 100
    units = units[units > 0]
    A = node_matrix(cfs_all, list(units.index), dates, r)
    cash = A.to_numpy().T @ units.reindex(A.index).to_numpy() if len(A) else np.zeros(len(dates))
    E, _ = existing_cash(opts.holdings, cfs_all, dates, r)
    g = carry_growth(dates, r)
    req = liab["amount"].to_numpy() * opts.safety_margin / 100
    s_prev, rows = 0.0, []
    for t in range(len(dates)):
        avail = cash[t] + E[t] + (g[t] * s_prev if t else 0.0)
        paid = min(avail, req[t])
        if req[t] - paid < 0.5:  # ignore rounding dust
            paid = req[t]
        s_prev = max(avail - paid, 0.0)
        rows.append({"date": dates[t], "required": req[t], "bond_cash": cash[t] + E[t],
                     "paid": paid, "shortfall": req[t] - paid, "carried_out": s_prev,
                     "coverage": paid / req[t] if req[t] else 1.0})
    return pd.DataFrame(rows)


def residual_value(hold: pd.DataFrame, cfs_all: pd.DataFrame, bonds: pd.DataFrame, last_date) -> float:
    """Today's value of holdings' cash flows that arrive after the final payment."""
    total = 0.0
    yld = bonds.set_index("isin")["yield"]
    for h in hold.itertuples():
        cf = cfs_all[(cfs_all["isin"] == h.isin) & (cfs_all["date"] > last_date)]
        if len(cf):
            total += h.units * pv(cf["t"].to_numpy(), cf["cf"].to_numpy(), yld[h.isin] / 100)
    return total
