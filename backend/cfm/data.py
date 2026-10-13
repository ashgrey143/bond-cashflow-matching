"""Load CCIL Trading Platform data (PDF, Excel, CSV or the site's JSON) and
classify every security.

CCIL publishes one row per security per trading day (and, on the website,
per platform: All / NDS-OM / Reported). The coupon is only in the security
description ("6.94% GS 2036"), so it is parsed from there.
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_FILE = ROOT / "data" / "sample" / "Trading_Platform_2026-08-20.pdf"

# normalised header (letters only, lower case) -> our column
COLUMNS = {
    "date": "date",
    "isinno": "isin", "isin": "isin",
    "securitydescription": "description", "security": "description",
    "type": "type", "securitytype": "type",
    "maturitydate": "maturity",
    "trades": "trades", "nooftrades": "trades",
    "totalvolume": "volume", "volume": "volume", "volumeamtcr": "volume",
    "highprice": "high", "lowprice": "low",
    "lasttradedprice": "ltp", "lasttradedytm": "ltp_ytm",
    "wtdavgprice": "price", "weightedavgprice": "price",
    "wtdavgyield": "ytm", "weightedavgyield": "ytm",
    "platform": "platform",
    "yearofmaturity": "maturity_year",
}
REQUIRED = {"isin", "description", "maturity", "price"}


def _key(col) -> str:
    return re.sub(r"[^a-z]", "", str(col).lower())


def normalise(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={c: COLUMNS.get(_key(c), _key(c)) for c in df.columns})
    df = df.loc[:, ~df.columns.duplicated()]
    missing = REQUIRED - set(df.columns)
    if missing:
        raise ValueError(f"Not a CCIL Trading Platform file: missing {', '.join(sorted(missing))}")
    return df


# ---------------------------------------------------------------- readers

def read_pdf(source) -> pd.DataFrame:
    import pdfplumber

    rows, header = [], None
    with pdfplumber.open(source) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if row and str(row[0]).strip() == "Date":
                        header = [str(c).strip() for c in row]
                    elif header and row and len(row) == len(header) and row[0]:
                        rows.append(row)
    if not header:
        raise ValueError("No CCIL table found in the PDF")
    return pd.DataFrame(rows, columns=header)


def read_excel(source) -> pd.DataFrame:
    df = pd.read_excel(source, header=None)
    # exports can carry a title row above the header: start at the ISIN row
    is_hdr = df.astype(str).apply(lambda r: r.str.contains("ISIN", case=False).any(), axis=1)
    if not is_hdr.any():
        raise ValueError("No ISIN column found in the spreadsheet")
    hdr = is_hdr.idxmax()
    df.columns = df.loc[hdr]
    return df.loc[hdr + 1:].dropna(how="all")


def read_ccil_json(payload) -> pd.DataFrame:
    if isinstance(payload, (bytes, str)):
        payload = json.loads(payload)
    data = payload.get("data", payload) if isinstance(payload, dict) else payload
    if not data:
        raise ValueError("CCIL returned no rows")
    return pd.DataFrame(data)


def read_any(source, name: str = "") -> pd.DataFrame:
    """Read a CCIL export from a path, bytes or file object."""
    name = (name or str(source)).lower()
    if isinstance(source, bytes):
        source = io.BytesIO(source)
    if name.endswith(".pdf"):
        return normalise(read_pdf(source))
    if name.endswith((".xlsx", ".xls")):
        return normalise(read_excel(source))
    if name.endswith(".json"):
        raw = source.read() if hasattr(source, "read") else Path(source).read_bytes()
        return normalise(read_ccil_json(raw))
    return normalise(pd.read_csv(source))


# ---------------------------------------------------------------- cleaning

STRIP_RE = re.compile(r"GS\d{2}[A-Z]{3}\d{4}[CP]$", re.I)
COUPON_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*%")


def _dates(s: pd.Series) -> pd.Series:
    s = s.astype(str).str.strip()
    iso = s.str.match(r"^\d{4}-\d{2}-\d{2}")
    out = pd.Series(pd.NaT, index=s.index, dtype="datetime64[ns]")
    out[iso] = pd.to_datetime(s[iso].str[:10], format="%Y-%m-%d", errors="coerce")
    out[~iso] = pd.to_datetime(s[~iso], dayfirst=True, errors="coerce")
    return out


def classify(desc: str, sec_type: str) -> tuple[str, str, float | None, str]:
    """-> (category, kind, coupon %, exclusion reason or '')."""
    d, t = desc.upper(), (sec_type or "").upper()
    if t in {"TB", "TBILL", "T-BILL"} or "DTB" in d:
        return "T-Bill", "Treasury bill", 0.0, ""
    cat = "SDL" if t == "SDL" or re.search(r"\b(SDL|SGS|UDAY)\b", d) else "G-Sec"
    if "FLOATING" in d or re.search(r"\bFRB\b", d):
        return cat, "Floating rate bond", None, "Floating coupon: future cash flows unknown"
    if d.startswith("SGB"):
        return cat, "Sovereign gold bond", None, "Gold bond: pays the gold price, not fixed cash"
    if STRIP_RE.search(d.replace("%%", "%").replace(" ", "")):
        return cat, "STRIPS", None, "STRIPS (single stripped coupon/principal)"
    if re.search(r"\b(IIB|CIB|INFLATION)\b", d):
        return cat, "Inflation indexed", None, "Inflation-indexed: cash flows not fixed"
    m = COUPON_RE.match(d)
    if not m:
        return cat, "Unknown", None, "No fixed coupon in description"
    kind = ("Sovereign green bond" if "SGRB" in d else
            "Special bond" if re.search(r"\b(SB|OIL|FCI)\b", d) else
            "State development loan" if cat == "SDL" else "Fixed-coupon G-Sec")
    return cat, kind, float(m.group(1)), ""


def next_business_day(d: pd.Timestamp) -> pd.Timestamp:
    d = d + pd.Timedelta(days=1)
    while d.weekday() >= 5:
        d += pd.Timedelta(days=1)
    return d


def clean(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """One row per ISIN (latest trading day, 'All' platform), classified.

    Returns (bonds, info). Structural exclusions keep their reason in
    `struct_reason`; option-based filters are applied later in `universe`.
    """
    df = raw.copy()
    n_raw = len(df)
    if "platform" in df:
        plat = df["platform"].astype(str).str.strip().str.upper()
        if (plat == "ALL").any():
            df = df[plat == "ALL"]
    if "date" not in df:
        df["date"] = pd.NaT
    df["date"] = _dates(df["date"]) if df["date"].notna().any() else pd.NaT
    df["maturity"] = _dates(df["maturity"])
    for c in ["price", "ytm", "volume", "trades", "ltp", "ltp_ytm", "high", "low"]:
        if c in df:
            df[c] = pd.to_numeric(df[c].astype(str).str.replace(",", ""), errors="coerce")
        else:
            df[c] = np.nan
    df["description"] = df["description"].astype(str).str.strip()
    df["isin"] = df["isin"].astype(str).str.strip()
    df["type"] = df.get("type", pd.Series("", index=df.index)).astype(str).str.strip()
    df = df[df["isin"].str.len() > 5]

    trade_dates = sorted(d.date().isoformat() for d in df["date"].dropna().unique())
    df = df.sort_values("date").drop_duplicates("isin", keep="last")

    last = df["date"].max()
    if pd.isna(last):
        last = pd.Timestamp.today().normalize()
        df["date"] = last
    settle = next_business_day(last)  # G-Secs settle T+1

    cls = [classify(d, t) for d, t in zip(df["description"], df["type"])]
    df["category"] = [c[0] for c in cls]
    df["kind"] = [c[1] for c in cls]
    df["coupon"] = [c[2] for c in cls]
    reason = pd.Series([c[3] for c in cls], index=df.index)
    reason[(reason == "") & (df["maturity"] <= settle)] = "Matures on/before settlement"
    reason[(reason == "") & (df["price"].isna() | (df["price"] <= 0))] = "Missing price"
    df["struct_reason"] = reason
    df["stale_days"] = (last - df["date"]).dt.days
    df = df.sort_values(["maturity", "isin"]).reset_index(drop=True)

    cols = ["isin", "description", "category", "kind", "coupon", "maturity", "price",
            "ytm", "ltp", "ltp_ytm", "volume", "trades", "date", "stale_days", "struct_reason"]
    info = {
        "rows": n_raw,
        "securities": int(len(df)),
        "trade_dates": trade_dates,
        "last_trade_date": last.date().isoformat(),
        "settle": settle.date().isoformat(),
        "categories": df["category"].value_counts().to_dict(),
    }
    return df[cols], info


DEFAULT_FILTERS = {
    "include_gsec": True,
    "include_sdl": False,
    "include_tbill": True,
    "min_trades": 0,
    "min_volume": 0.0,      # Rs crore traded on the day
    "max_stale_days": 99,
    "exclude": [],          # ISINs
}


def universe(bonds: pd.DataFrame, filters: dict | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Apply structural + user filters -> (eligible, excluded with reason)."""
    f = {**DEFAULT_FILTERS, **(filters or {})}
    reason = bonds["struct_reason"].copy()

    def mark(mask, text):
        reason[(reason == "") & mask] = text

    mark((bonds["category"] == "G-Sec") & (not f["include_gsec"]), "G-Secs switched off")
    mark((bonds["category"] == "SDL") & (not f["include_sdl"]), "SDLs switched off")
    mark((bonds["category"] == "T-Bill") & (not f["include_tbill"]), "T-Bills switched off")
    mark(bonds["isin"].isin(f["exclude"]), "Excluded by user")
    mark(bonds["trades"].fillna(0) < f["min_trades"], f"Fewer than {f['min_trades']} trades")
    mark(bonds["volume"].fillna(0) < f["min_volume"], f"Volume below Rs {f['min_volume']} cr")
    mark(bonds["stale_days"].fillna(0) > f["max_stale_days"], "Price older than allowed")
    keep = reason == ""
    return (bonds[keep].reset_index(drop=True),
            bonds[~keep].assign(reason=reason[~keep]).reset_index(drop=True))


def load_sample() -> tuple[pd.DataFrame, dict]:
    return clean(read_any(SAMPLE_FILE))
