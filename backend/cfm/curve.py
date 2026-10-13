"""Nelson-Siegel zero-coupon curve fitted to G-Sec prices.

Used to value the liabilities (their present value and duration), so the
optimised portfolio can be compared with what the liabilities are worth at
today's market rates.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.optimize import least_squares


def _ns(t, b0, b1, b2, tau):
    t = np.maximum(np.asarray(t, float), 1e-6)
    x = t / tau
    f1 = (1 - np.exp(-x)) / x
    return b0 + b1 * f1 + b2 * (f1 - np.exp(-x))


@dataclass
class Curve:
    params: tuple
    rmse_bp: float
    n: int

    def zero(self, t):
        """Continuously compounded zero rate (decimal)."""
        return _ns(t, *self.params)

    def zero_sa(self, t):
        """Zero rate as a semi-annually compounded yield (decimal)."""
        return 2 * (np.exp(self.zero(t) / 2) - 1)

    def df(self, t, shift_bp: float = 0.0):
        t = np.asarray(t, float)
        y = self.zero_sa(t) + shift_bp / 1e4
        return (1 + y / 2) ** (-2 * t)


def fit(bonds: pd.DataFrame, cfs: pd.DataFrame) -> Curve:
    """Fit to sovereign bonds (G-Secs and T-Bills) by price error / duration."""
    sov = bonds[bonds["category"].isin(["G-Sec", "T-Bill"])]
    if len(sov) < 4:
        sov = bonds
    groups = dict(tuple(cfs[cfs["isin"].isin(sov["isin"])].groupby("isin")))
    items = [(groups[b.isin]["t"].to_numpy(), groups[b.isin]["cf"].to_numpy(),
              b.dirty, max(b.mod_dur, 0.05), np.sqrt(1 + (b.volume if b.volume == b.volume else 0)))
             for b in sov.itertuples()]

    def resid(p):
        out = []
        for t, cf, price, dur, w in items:
            model = (cf * np.exp(-_ns(t, *p) * t)).sum()
            out.append(w * (model - price) / (price * dur))
        return np.array(out)

    y0 = np.nanmedian(sov["yield"]) / 100 if len(sov) else 0.07
    res = least_squares(resid, x0=[y0, -0.01, 0.0, 2.0],
                        bounds=([-0.05, -0.2, -0.3, 0.1], [0.25, 0.2, 0.3, 30]))
    # unweighted yield-error RMSE in basis points
    errs = []
    for t, cf, price, dur, _ in items:
        model = (cf * np.exp(-_ns(t, *res.x) * t)).sum()
        errs.append((model - price) / (price * dur))
    return Curve(tuple(float(v) for v in res.x), float(np.sqrt(np.mean(np.square(errs))) * 1e4), len(items))
