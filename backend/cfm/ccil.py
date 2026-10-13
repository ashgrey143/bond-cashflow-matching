"""Fetch the latest Trading Platform data from the CCIL website.

The public page https://www.ccilindia.com/trading-platform fills its table
from a JSON endpoint; with no search filters it returns the most recent
trading days for all securities (G-Sec, SDL, T-Bill). No sign-in is needed
for this view (sign-in is only for the site's own Excel/PDF download).

CCIL's note: data on its website is not authorised for commercial use
without written permission. This project uses it for academic purposes.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import requests

from .data import ROOT

PAGE_URL = "https://www.ccilindia.com/trading-platform"
_PORTLET = "NewTradingPlatformMVCAjax_NewTradingPlatformMVCAjaxPortlet_INSTANCE_ltic"
DATA_URL = (f"{PAGE_URL}?p_p_id={_PORTLET}&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view"
            f"&p_p_resource_id=searchNotClicked&p_p_cacheability=cacheLevelPage"
            f"&_{_PORTLET}_cmd=jsonUserObjectArray")
CACHE_DIR = ROOT / "data" / "cache"


class CCILError(RuntimeError):
    pass


def fetch_latest(timeout: float = 30) -> tuple[dict, Path]:
    """Download the latest CCIL data and cache it. Returns (payload, cache path)."""
    try:
        r = requests.post(
            DATA_URL,
            data={"draw": 1, "start": 0, "length": 5000},
            headers={"User-Agent": "Mozilla/5.0 (bond cash-flow matching, academic project)",
                     "X-Requested-With": "XMLHttpRequest", "Referer": PAGE_URL},
            timeout=timeout,
        )
        r.raise_for_status()
        payload = r.json()
    except requests.RequestException as e:
        raise CCILError(f"Could not reach CCIL: {e}") from e
    except ValueError as e:
        raise CCILError("CCIL did not return data (the site may be down or blocking the request)") from e
    if not payload.get("data"):
        raise CCILError("CCIL returned no rows")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dates = sorted({row.get("Date", "")[:10] for row in payload["data"]})
    path = CACHE_DIR / f"ccil_{dates[-1] or datetime.now().strftime('%Y-%m-%d')}.json"
    path.write_text(json.dumps(payload))
    return payload, path


def latest_cache() -> Path | None:
    files = sorted(CACHE_DIR.glob("ccil_*.json"))
    return files[-1] if files else None
