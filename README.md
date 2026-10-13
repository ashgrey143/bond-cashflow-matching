# Bond Cash-Flow Matching using Network Optimization

Financial Engineering project (Team 8). An institution knows the payments it must make in the future; this tool finds the
cheapest set of Indian Government Securities whose coupons and redemptions pay every one of them on time, then shows how
safe, liquid and defensible that portfolio is.

## Run it

```bash
pip install -r requirements.txt
./run.sh                     # builds the dashboard once, then serves everything at http://localhost:8000
```

`run.sh` uses `python3`; set `PYTHON=/path/to/python` to use a specific interpreter or virtualenv.

For development (hot reload), run the API and the dashboard separately:

```bash
python -m uvicorn api:app --app-dir backend --reload --port 8000
npm --prefix frontend run dev          # http://localhost:5173 (proxies /api to :8000)
```

Tests: `cd backend && python -m pytest -q`

## Run with Docker

One image holds the API and the built dashboard: Node builds the frontend, then a slim Python image serves both.

```bash
docker compose up -d --build        # http://localhost:8000
PORT=8080 docker compose up -d      # use another host port
docker compose logs -f              # follow logs
docker compose down                 # stop (add -v to also delete the CCIL cache volume)
```

Without compose:

```bash
docker build -t cashflow-matching .
docker run -p 8000:8000 -v ccil-cache:/app/backend/data/cache cashflow-matching
```

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: `frontend` (npm build) → `base` (Python deps) → `test` (runs pytest) → `runtime` (non-root user, healthcheck on `/api/health`) |
| `docker-compose.yml` | Production: one container, a named volume `ccil-cache` so CCIL downloads survive restarts |
| `docker-compose.dev.yml` | Development: backend with `--reload` and the source mounted, Vite dev server on :5173 proxying to the backend container |

Run the tests in Docker: `docker build --target test .` (the build fails if any test fails).

Develop in Docker with hot reload: `docker compose -f docker-compose.dev.yml up --build`, then open http://localhost:5173.

The container needs outbound internet only for the **CCIL live** option; sample and uploaded data work offline.

## Bond data: three sources

| Source | What it does |
|---|---|
| **Sample** | The bundled CCIL Trading Platform export for 19–20 Aug 2026 (`backend/data/sample/`). Repeatable results. |
| **Upload** | A Trading Platform export as PDF, Excel, CSV or JSON. Title rows and column-name variants are handled. |
| **CCIL live** | Fetches the latest trading days from the public table at [ccilindia.com/trading-platform](https://www.ccilindia.com/trading-platform) (no sign-in). Each download is cached in `backend/data/cache/`; if CCIL can't be reached, the last download is used. |

CCIL does not authorise commercial use of its website data without written permission. This project is academic.

## How it works

1. **Clean.** Keep one row per ISIN: the latest trading day and CCIL's "All" platform row. The website also lists NDS-OM and Reported rows separately.
2. **Classify.** Parse the coupon from the description ("6.94% GS 2036"). Exclude floating-rate bonds, gold bonds, inflation-indexed bonds and STRIPS, because their cash flows are not fixed. T-Bills and SDLs are optional.
3. **Build cash flows.** Semi-annual coupons on the maturity day/month, 30/360, ₹100 face. The price paid is the dirty price: CCIL clean price + accrued interest to T+1 settlement. As a validation, repricing every bond from CCIL's own yield matches CCIL's price to within about ₹0.06 per ₹100.
4. **Network LP** (SciPy HiGHS). Each payment date is a node; bond cash flows into the next date; surplus moves along carry arcs:

   ```
   minimise    Σ Pᵢ xᵢ
   subject to  Σ CFᵢ,ₜ xᵢ + gₜ sₜ₋₁ − sₜ = m·Lₜ − Eₜ    for every payment date t
               Pᵢ xᵢ ≤ w Σ Pⱼ xⱼ   (optional per-bond limit),   xᵢ, sₜ ≥ 0,   whole lots optional (MILP)
   ```

   If the budget is too small, the model covers the earliest payments first and reports the shortfall. If no portfolio is possible, it explains why in plain words.
5. **Analytics.**
   - Shadow prices: the cost today of ₹1 due on each date.
   - Reduced costs: how much cheaper an unused bond would need to be to get picked.
   - Duration and convexity of the portfolio vs the liabilities, using a Nelson–Siegel curve fitted to G-Sec prices.
   - Rate shocks of ±200 bp.
   - What-if scenarios and a liability uncertainty range.
   - Comparison with manual selection and with duration matching.
   - Cost of policy limits.

## Dashboard

**Inputs (left panel):**
- Data source
- Liabilities: edit them in the table, upload a CSV/Excel file, or generate them from a pattern
- Bond universe: G-Sec, T-Bill and SDL switches, plus minimum trades, minimum volume and price-age filters
- Investment rules: budget, safety margin, max % per bond, lot size, volume cap, transaction cost, reinvestment rate
- Bonds already held

Results update automatically when an input changes.

**Results:** a summary banner and key figures, followed by these tabs:

| Tab | Contents |
|---|---|
| Overview | Cash vs payment due at each date; the cash-flow network (Sankey); insights |
| Buy list | Allocation, bonds and amounts, liquidity check (order vs day volume), buy-order CSV, committee report (Excel) |
| Cash flows | Month-by-month cash calendar, coverage table, cash-flow matrix CFᵢ,ₜ |
| Why these bonds | Shadow prices per date; why each bond was chosen; bonds that just missed out |
| Rate risk | Value change under rate shifts; duration vs duration + convexity estimates; surplus at market value |
| What-if | Preset scenarios, a custom scenario builder, liability uncertainty |
| Strategies | Optimised vs manual vs duration matching; cost of per-bond and liquidity limits |
| Market data | Yield curve with the fitted zero curve; eligible and excluded securities |
| Method | Model, data conventions, assumptions |

## Layout

```
backend/
  api.py            FastAPI app (also serves frontend/dist)
  cfm/data.py       read and classify CCIL data
  cfm/ccil.py       live fetch from the CCIL website
  cfm/bonds.py      cash flows, accrued interest, yields, duration, convexity
  cfm/curve.py      Nelson–Siegel zero curve
  cfm/optimizer.py  network LP / MILP, budget mode, diagnosis, duals
  cfm/analytics.py  risk, scenarios, strategies, calendar, Sankey
  cfm/service.py    datasets in memory and the full run
  cfm/report.py     Excel committee report and CSV buy order
  tests/            pytest suite (hand-checked LPs, parsers, API)
frontend/           React + TypeScript + Tailwind, shadcn-style components (Radix), Recharts
```

## Limits

- Prices are one day's weighted averages. Thinly traded bonds are flagged; use the liquidity filters for a real order.
- Rate scenarios are parallel shifts. Liabilities are valued on a fitted curve, and bonds on their own yields.
- Holidays are not modelled when computing T+1 settlement (weekends are).
