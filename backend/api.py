"""HTTP API for the dashboard.

Run:  uvicorn api:app --reload --port 8000   (from the backend folder)
The built dashboard (frontend/dist) is served from / when it exists.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from cfm import ccil, report, service

app = FastAPI(title="Bond Cash-Flow Matching API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

MAX_UPLOAD = 25 * 1024 * 1024


class Liability(BaseModel):
    date: str
    amount: float


class RunRequest(BaseModel):
    dataset_id: str
    liabilities: list[Liability]
    options: dict = Field(default_factory=dict)
    filters: dict = Field(default_factory=dict)


class ScenarioRequest(RunRequest):
    custom: dict = Field(default_factory=dict)


def _dataset(ds_id: str) -> service.Dataset:
    ds = service.DATASETS.get(ds_id)
    if ds is None:
        if ds_id == "sample":
            return service.load_sample()
        raise HTTPException(404, "Dataset not found. Load the data again.")
    return ds


def _dataset_payload(ds: service.Dataset, note: str | None = None) -> dict:
    return {"dataset": ds.summary(), "default_liabilities": service.default_liabilities(ds.settle),
            "note": note}


@app.get("/api/health")
def health():
    return {"ok": True, "ccil_cache": str(ccil.latest_cache() or "")}


@app.post("/api/datasets/sample")
def dataset_sample():
    return _dataset_payload(service.load_sample())


@app.post("/api/datasets/upload")
async def dataset_upload(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "File is larger than 25 MB")
    try:
        ds = service.load_upload(content, file.filename or "upload.csv")
    except Exception as e:  # parsing errors are shown to the user
        raise HTTPException(422, f"Could not read {file.filename}: {e}")
    return _dataset_payload(ds)


@app.post("/api/datasets/ccil")
def dataset_ccil():
    try:
        ds, note = service.load_ccil()
    except ccil.CCILError as e:
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(500, f"CCIL data could not be processed: {e}")
    return _dataset_payload(ds, note)


@app.post("/api/liabilities/parse")
async def liabilities_parse(file: UploadFile = File(...)):
    """CSV/Excel with a date column and an amount column (Rs, or Rs crore if the
    header says 'cr')."""
    content = await file.read()
    name = (file.filename or "").lower()
    try:
        df = pd.read_excel(io.BytesIO(content)) if name.endswith((".xlsx", ".xls")) \
            else pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(422, f"Could not read the file: {e}")
    cols = {c: re.sub(r"[^a-z]", "", str(c).lower()) for c in df.columns}
    dcol = next((c for c, k in cols.items() if "date" in k), None)
    acol = next((c for c, k in cols.items() if any(w in k for w in ("amount", "liability", "payment", "value"))), None)
    if dcol is None or acol is None:
        raise HTTPException(422, "Need a 'date' column and an 'amount' column")
    scale = 1e7 if re.search(r"cr", str(acol), re.I) else 1.0
    dates = pd.to_datetime(df[dcol], dayfirst=True, errors="coerce")
    amounts = pd.to_numeric(df[acol].astype(str).str.replace(",", ""), errors="coerce") * scale
    out = [{"date": d.strftime("%Y-%m-%d"), "amount": float(a)}
           for d, a in zip(dates, amounts) if pd.notna(d) and pd.notna(a) and a > 0]
    if not out:
        raise HTTPException(422, "No valid rows (date + positive amount) found")
    return {"liabilities": out, "scaled_from_crore": scale > 1}


def _liabs(req: RunRequest):
    return [l.model_dump() for l in req.liabilities]


@app.post("/api/optimize")
def optimize(req: RunRequest):
    ds = _dataset(req.dataset_id)
    return service.run(ds, _liabs(req), req.options, req.filters)


@app.post("/api/scenario")
def scenario(req: ScenarioRequest):
    ds = _dataset(req.dataset_id)
    return service.run_custom(ds, _liabs(req), req.options, req.filters, req.custom)


@app.post("/api/report/xlsx")
def report_xlsx(req: RunRequest):
    ds = _dataset(req.dataset_id)
    res = service.run(ds, _liabs(req), req.options, req.filters)
    if res["status"] == "infeasible":
        raise HTTPException(422, res["message"])
    return Response(report.workbook(res),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="cashflow_matching_{res["settle"]}.xlsx"'})


@app.post("/api/report/buy-order")
def report_buy_order(req: RunRequest):
    ds = _dataset(req.dataset_id)
    res = service.run(ds, _liabs(req), req.options, req.filters, full=False)
    if res["status"] == "infeasible":
        raise HTTPException(422, res["message"])
    return Response(report.buy_order_csv(res), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="buy_order_{res["settle"]}.csv"'})


# ---- serve the built dashboard
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
