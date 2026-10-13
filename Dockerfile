# syntax=docker/dockerfile:1
# Bond Cash-Flow Matching: one image with the API and the built dashboard.
#   docker build -t cashflow-matching .
#   docker run -p 8000:8000 cashflow-matching          -> http://localhost:8000
#   docker build --target test .                        -> runs the test suite

# ---------- 1. build the React dashboard ----------
FROM node:20.18-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 2. Python dependencies ----------
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# ---------- 3. tests (optional target) ----------
FROM base AS test
COPY backend/ backend/
WORKDIR /app/backend
RUN python -m pytest -q

# ---------- 4. runtime ----------
FROM base AS runtime
RUN useradd --create-home --uid 10001 app
COPY --chown=app:app backend/ backend/
COPY --from=frontend --chown=app:app /frontend/dist frontend/dist
RUN mkdir -p backend/data/cache && chown -R app:app backend/data/cache
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
CMD ["python", "-m", "uvicorn", "api:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
