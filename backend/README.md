# backend/ — developer A zone

A FastAPI API. It reads the ready-made files from `data/` (DuckDB, read-only) and serves responses
strictly following the contract `contract/openapi.yaml`.

Tasks from the spec: A6 (skeleton, `/health`, `/meta`, `/calendar`), A11 (the remaining endpoints, limits, errors), A13 (deployment).

## Running

The data must be in `data/` (how to get it — `data/README.md`): `grid_daily.parquet`, `grid_monthly.parquet`,
`coefficients.parquet`, `uncertainty.parquet`, `outage_months.csv`, `harmonized/summary.json`;
for `/points` and `/export/points.csv` — `points_serve/` (`python pipeline/points_serve.py`).

```bash
python -m venv .venv
.venv/Scripts/pip install -e "backend[dev]"     # Linux/macOS: .venv/bin/pip
cd backend
uvicorn app.main:app --port 8000
```

API documentation: http://localhost:8000/api/v1/docs. For the frontend: `VITE_API_URL=http://localhost:8000/api/v1`.

Environment variables (`.env.example`): `DATA_DIR` (default: `data/` in the repository root), `POINTS_DIR`
(default: `DATA_DIR/points_serve`; the full `data/points` also works), `CORS_ORIGINS`,
`DUCKDB_MEMORY_LIMIT` (2GB), `DUCKDB_THREADS` (2).

## What is ready

| Endpoint | Status |
| --- | --- |
| `GET /health`, `GET /meta` | done |
| `POST /calendar`, `POST /export/calendar.csv` | done |
| `POST /current`, `POST /daily` | done |
| `POST /points`, `POST /export/points.csv` | done |
| `GET /method/validation` | done |

## How it works

- `app/geometry.py` — GeoJSON validation, geodesic area (WGS84), 0.1° cells whose center lies inside the area.
- `app/series.py` — sum over the cells of the area: raw count of the lead source × the 1° cell coefficient
  (`data/coefficients.parquet`). The lead-source rule is the shared module `pipeline/lead.py`.
- `app/daily_service.py` — `/current`: accumulation since the 1st of the month against the same days of the baseline years; `/daily`: values by day of the year.
- `app/calendar_service.py` — medians and percentiles over the baseline years, categories, `low`/`high` intervals
  (`data/uncertainty.parquet`), yearly totals, trend (least squares), warnings.
- `app/points_service.py` — points from `points_serve/`: selection by date and bounding box in DuckDB (row-group skipping),
  then an exact polygon test; `harmonized_weight` is the 1° cell coefficient of the lead source (S-NPP — 1).
  Above `max_points`, the 20,000 points with the highest FRP are returned with `truncated = true`; the CSV is streamed.
- `/calendar` responses are cached in memory (the 200 most recent requests).
- Errors are always `{"error": {"code", "message"}}`; request-body validation errors are returned as 400 `INVALID_REQUEST`.

## Checks (as in CI)

```bash
cd backend
ruff check . && ruff format --check . && pytest -q
```

The tests build a tiny synthetic `DATA_DIR` and check every response against the schema from `contract/openapi.yaml`.
