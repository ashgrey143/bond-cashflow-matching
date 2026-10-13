"""Bond cash flows, prices, yields and risk measures.

Conventions for Indian Government Securities and SDLs: face value 100,
semi-annual coupons on the maturity day/month, 30/360 day count, yields
compounded semi-annually. CCIL prices are clean, so the invoice (dirty)
price adds accrued interest up to settlement (T+1). T-Bills are zero-coupon
and repay 100 at maturity (actual/365).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta
from scipy.optimize import brentq

FACE = 100.0


def days_30_360(d1: pd.Timestamp, d2: pd.Timestamp) -> int:
    day1, day2 = min(d1.day, 30), d2.day
    if day1 == 30 and day2 == 31:
        day2 = 30
    return 360 * (d2.year - d1.year) + 30 * (d2.month - d1.month) + (day2 - day1)


def coupon_dates(maturity: pd.Timestamp, settle: pd.Timestamp) -> tuple[list, pd.Timestamp]:
    """Future coupon dates after settle, and the last coupon date on/before settle."""
    dates, k = [], 0
    while True:
        d = pd.Timestamp(maturity - relativedelta(months=6 * k))
        if d <= settle:
            return dates[::-1], d
        dates.append(d)
        k += 1


def year_frac(settle, d, zero: bool) -> float:
    return (d - settle).days / 365 if zero else days_30_360(settle, d) / 360


def cashflows(bond, settle: pd.Timestamp) -> pd.DataFrame:
    """Future cash flows per 100 face for one bond row."""
    zero = bond["category"] == "T-Bill"
    if zero:
        dates, amounts = [bond["maturity"]], [FACE]
    else:
        dates, _ = coupon_dates(bond["maturity"], settle)
        amounts = [bond["coupon"] / 2] * len(dates)
        amounts[-1] += FACE
    t = [year_frac(settle, d, zero) for d in dates]
    return pd.DataFrame({"isin": bond["isin"], "date": dates, "t": t, "cf": amounts})


def accrued(bond, settle: pd.Timestamp) -> float:
    if bond["category"] == "T-Bill":
        return 0.0
    _, last = coupon_dates(bond["maturity"], settle)
    return bond["coupon"] / 2 * days_30_360(last, settle) / 180


def pv(t: np.ndarray, cf: np.ndarray, y: float) -> float:
    return float((cf * (1 + y / 2) ** (-2 * t)).sum())


def solve_yield(t: np.ndarray, cf: np.ndarray, price: float) -> float:
    try:
        return brentq(lambda y: pv(t, cf, y) - price, -0.5, 2.0)
    except ValueError:
        return float("nan")


def risk_from_cf(t: np.ndarray, cf: np.ndarray, y: float) -> dict:
    """Price, Macaulay/modified duration and convexity at yield y (decimal, s.a.)."""
    disc = (1 + y / 2) ** (-2 * t)
    v = cf * disc
    price = v.sum()
    mac = (t * v).sum() / price
    conv = (cf * t * (t + 0.5) * disc).sum() / price / (1 + y / 2) ** 2
    return {"dirty": price, "mac_dur": mac, "mod_dur": mac / (1 + y / 2), "convexity": conv}


def enrich(bonds: pd.DataFrame, settle: pd.Timestamp) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Add accrued, dirty price, own yield and risk measures.

    Returns (bonds, cash flows). `model_dirty` reprices each bond from the CCIL
    yield; comparing it with `dirty` validates the cash-flow construction.
    """
    cfs, rows = [], []
    for _, b in bonds.iterrows():
        cf = cashflows(b, settle)
        t, c = cf["t"].to_numpy(), cf["cf"].to_numpy()
        acc = accrued(b, settle)
        dirty = b["price"] + acc
        y = solve_yield(t, c, dirty)
        r = risk_from_cf(t, c, y)
        ccil_y = b["ytm"] / 100 if pd.notna(b.get("ytm")) else y
        rows.append({
            "accrued": acc, "dirty": dirty, "yield": y * 100,
            "model_dirty": pv(t, c, ccil_y),
            "mac_dur": r["mac_dur"], "mod_dur": r["mod_dur"], "convexity": r["convexity"],
            "years": t[-1], "n_cf": len(t),
        })
        cfs.append(cf)
    out = pd.concat([bonds.reset_index(drop=True), pd.DataFrame(rows)], axis=1)
    out["price_check"] = out["model_dirty"] - out["dirty"]
    return out, (pd.concat(cfs, ignore_index=True) if cfs else
                 pd.DataFrame(columns=["isin", "date", "t", "cf"]))


def reprice(bonds: pd.DataFrame, cfs: pd.DataFrame, shift_bp: float) -> pd.Series:
    """Dirty price of each bond after a parallel shift of its yield."""
    out = {}
    grouped = dict(tuple(cfs.groupby("isin")))
    for _, b in bonds.iterrows():
        cf = grouped[b["isin"]]
        out[b["isin"]] = pv(cf["t"].to_numpy(), cf["cf"].to_numpy(),
                            b["yield"] / 100 + shift_bp / 1e4)
    return pd.Series(out)
