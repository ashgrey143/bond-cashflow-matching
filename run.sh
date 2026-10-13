#!/usr/bin/env bash
# Start the dashboard at http://localhost:8000 (builds the frontend the first time).
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
if [ ! -d frontend/dist ]; then
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi
echo "Dashboard: http://localhost:8000"
exec "$PY" -m uvicorn api:app --app-dir backend --port 8000
