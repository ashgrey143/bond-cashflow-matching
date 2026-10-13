import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from cfm import bonds as bd, data, service
from cfm.optimizer import Options, optimise

HERE = Path(__file__).parent
LIVE = HERE / "ccil_live_fixture.json"


# ------------------------------------------------------------- data

def test_sample_pdf_parses_and_filters():
    df, info = data.load_sample()
    assert info["rows"] == 123 and info["securities"] == 82
    assert info["settle"] == "2026-08-21"          # T+1 after 20-Aug-2026
    usable = df[df["struct_reason"] == ""]
    assert len(usable) == 72
    reasons = df.loc[df["struct_reason"] != "", "kind"].value_counts().to_dict()
    assert reasons == {"Sovereign gold bond": 4, "Floating rate bond": 3, "STRIPS": 3}


def test_live_json_keeps_one_row_per_isin_from_all_platform():
    raw = data.normalise(data.read_ccil_json(LIVE.read_text()))
    assert set(raw["platform"]) == {"All", "NDS-OM", "Reported"}
    df, info = data.clean(raw)
    assert df["isin"].is_unique
    assert set(info["categories"]) == {"G-Sec", "SDL", "T-Bill"}


@pytest.mark.parametrize("desc,typ,expect", [
    ("6.94% GS 2036", "GS", ("G-Sec", 6.94, "")),
    ("9.23% Govt Stock 2043", "GS", ("G-Sec", 9.23, "")),
    ("7.25% GOI SGrB 2028", "GS", ("G-Sec", 7.25, "")),
    ("7.22% MAHARASHTRA SDL 2026", "SDL", ("SDL", 7.22, "")),
    ("07/01/2027 MATURING 182 DTB", "TB", ("T-Bill", 0.0, "")),
])
def test_classify_fixed_coupon(desc, typ, expect):
    cat, _, cpn, reason = data.classify(desc, typ)
    assert (cat, cpn, reason) == expect


@pytest.mark.parametrize("desc", ["GOI FLOATING RATE BOND 2031", "SGB 2023-24 SERIES I",
                                  "GS18NOV2026C", "7.4%%GS19SEP2062P", "7.23%GS15APR2039P"])
def test_classify_excluded(desc):
    assert data.classify(desc, "GS")[3] != ""


# ------------------------------------------------------------- bonds

def test_accrued_interest_30_360():
    b = {"category": "G-Sec", "coupon": 6.36, "maturity": pd.Timestamp("2031-02-16")}
    settle = pd.Timestamp("2026-08-21")
    # last coupon 16-Aug-2026, 5 days (30/360) of a 180-day half year
    assert bd.accrued(b, settle) == pytest.approx(3.18 * 5 / 180)
    cf = bd.cashflows({**b, "isin": "X"}, settle)
    assert cf["date"].iloc[0] == pd.Timestamp("2027-02-16")
    assert cf["cf"].iloc[-1] == pytest.approx(103.18) and len(cf) == 9


def test_ccil_yields_reproduce_ccil_prices():
    ds = service.load_sample()
    # Rs 0.06 per Rs 100 is about one basis point of yield on these bonds
    assert np.abs(ds.enriched["price_check"]).max() < 0.1


# ------------------------------------------------------------- model (hand-checkable)

def _toy(prices, flows):
    """flows: {isin: [(date, cf), ...]} per 100 face."""
    rows, cfs = [], []
    for isin, p in prices.items():
        rows.append({"isin": isin, "description": isin, "category": "T-Bill", "coupon": 0.0,
                     "maturity": pd.Timestamp(flows[isin][-1][0]), "price": p, "accrued": 0.0, "dirty": p,
                     "yield": 6.0, "ytm": 6.0, "mod_dur": 1.0, "convexity": 1.0, "volume": 100.0,
                     "trades": 10, "date": pd.Timestamp("2026-01-01"), "stale_days": 0})
        cfs += [{"isin": isin, "date": pd.Timestamp(d), "t": 1.0, "cf": c} for d, c in flows[isin]]
    return pd.DataFrame(rows), pd.DataFrame(cfs)


SETTLE = pd.Timestamp("2026-01-02")
LIAB = [{"date": "2027-01-01", "amount": 1000}, {"date": "2028-01-01", "amount": 2000}]


def test_lp_matches_hand_solution_and_duals():
    b, cfs = _toy({"A": 95, "B": 90}, {"A": [("2027-01-01", 100)], "B": [("2028-01-01", 100)]})
    r = optimise(b, cfs, LIAB, Options(), SETTLE)
    assert r["status"] == "optimal"
    x = r["x"]
    assert x["A"] == pytest.approx(10) and x["B"] == pytest.approx(20)
    assert r["cost"] == pytest.approx(950 + 1800)
    # cost today of Rs 1 due at each date = the zero's price per rupee
    assert r["duals"]["shadow_price"].tolist() == pytest.approx([0.95, 0.90])


def test_surplus_is_carried_forward():
    # only bond A exists; it pays before the first date, so the second payment
    # must come from cash carried along the network's carry arc
    b, cfs = _toy({"A": 95}, {"A": [("2026-12-01", 100)]})
    r = optimise(b, cfs, LIAB, Options(), SETTLE)
    assert r["x"]["A"] == pytest.approx(30)
    assert r["schedule"]["carried_out"].iloc[0] == pytest.approx(2000)
    r2 = optimise(b, cfs, LIAB, Options(reinvest_rate=10), SETTLE)
    assert r2["cost"] < r["cost"]  # reinvested surplus needs fewer bonds


def test_budget_protects_earliest_payment():
    b, cfs = _toy({"A": 95, "B": 90}, {"A": [("2027-01-01", 100)], "B": [("2028-01-01", 100)]})
    r = optimise(b, cfs, LIAB, Options(budget=1500), SETTLE)
    assert r["status"] == "shortfall"
    assert r["schedule"]["coverage"].iloc[0] == pytest.approx(1.0)
    assert r["cost"] == pytest.approx(1500)


def test_no_bond_before_first_payment_is_explained():
    b, cfs = _toy({"B": 90}, {"B": [("2028-01-01", 100)]})
    r = optimise(b, cfs, LIAB, Options(), SETTLE)
    assert r["status"] == "shortfall" and "No eligible bond pays anything" in r["message"]
    assert r["schedule"]["coverage"].iloc[0] == 0


def test_max_weight_and_whole_lots():
    ds = service.load_sample()
    L = service.default_liabilities(ds.settle)
    r = service.run(ds, L, {"max_weight": 20, "lot_face": 100000}, full=False)
    assert r["status"] == "optimal"
    w = [h["weight"] for h in r["holdings"]]
    assert max(w) <= 0.20 + 1e-6
    assert all(abs(h["lots"] - round(h["lots"])) < 1e-6 for h in r["holdings"])


# ------------------------------------------------------------- full run

def test_full_run_on_sample():
    ds = service.load_sample()
    r = service.run(ds, service.default_liabilities(ds.settle))
    json.dumps(r)  # serialisable
    s = r["summary"]
    assert r["status"] == "optimal" and s["covered_all"]
    assert s["savings_vs_manual"] >= 0
    names = [x["name"] for x in r["scenarios"]]
    assert "Rates +0.5%" in names and "Liabilities +10%" in names
    # liabilities +10% costs exactly 10% more (the LP scales linearly)
    up = next(x for x in r["scenarios"] if x["name"] == "Liabilities +10%")
    assert up["cost"] == pytest.approx(s["cost"] * 1.1, rel=1e-6)


def test_live_data_with_tbills():
    raw = data.normalise(data.read_ccil_json(LIVE.read_text()))
    ds = service._register("ccil", "live", raw)
    L = [{"date": "2026-12-15", "amount": 5e6}] + service.default_liabilities(ds.settle)
    r = service.run(ds, L, full=False)
    assert r["status"] == "optimal"


# ------------------------------------------------------------- API

def test_api_flow():
    from api import app
    c = TestClient(app)
    d = c.post("/api/datasets/sample").json()
    body = {"dataset_id": d["dataset"]["id"], "liabilities": d["default_liabilities"]}
    r = c.post("/api/optimize", json=body).json()
    assert r["status"] == "optimal"
    x = c.post("/api/report/xlsx", json=body)
    assert x.status_code == 200 and x.content[:2] == b"PK"
    csv = c.post("/api/report/buy-order", json=body)
    assert "ISIN" in csv.text
    sc = c.post("/api/scenario", json={**body, "custom": {"rate_bp": 100, "liab_pct": 5}}).json()
    assert sc["status"] == "optimal" and "rates +100 bp" in sc["description"]
    up = c.post("/api/liabilities/parse",
                files={"file": ("l.csv", b"Date,Amount (Rs cr)\n31-03-2027,1.5\n31-03-2028,2\n", "text/csv")}).json()
    assert up["liabilities"][0] == {"date": "2027-03-31", "amount": 1.5e7}
