# backend/ — developer A zone

A FastAPI API. It reads the ready-made files from `data/` (DuckDB, read-only) and serves responses
strictly following the contract `contract/openapi.yaml`.

Tasks from the spec: A6 (skeleton, `/health`, `/meta`, `/calendar`), A11 (the remaining endpoints, limits, errors), A13 (deployment).

## Running

The data must be in `data/` (how to get it — `data/README.md`): `grid_daily.parquet`, `grid_monthly.parquet`,
`coefficients.parquet`, `uncertainty.parquet`, `outage_months.csv`, `harmonized/summary.json`;
for `/points` and `/export/points.csv` — `points_serve/` (`python pipeline/points_serve.py`).

The app reads only environment variables; it does not load `.env` by itself. Pass the file to uvicorn with
`--env-file`, otherwise `CORS_ORIGINS` is empty, no CORS headers are sent and a browser frontend on another port
(the Vite dev server on `:5173`) is blocked with "The server cannot be reached".

Windows PowerShell (from the repository root):

```powershell
python -m venv .venv
.venv\Scripts\pip install -c backend\constraints.txt -e "backend[dev]"
Copy-Item .env.example .env
cd backend
..\.venv\Scripts\uvicorn app.main:app --port 8000 --env-file ..\.env
```

bash (Linux, macOS, Git Bash; use `python3` where `python` is missing):

```bash
python -m venv .venv
.venv/bin/pip install -c backend/constraints.txt -e "backend[dev]"    # Git Bash on Windows: .venv/Scripts/pip
cp .env.example .env
cd backend
../.venv/bin/uvicorn app.main:app --port 8000 --env-file ../.env
```

`.env.example` allows `http://localhost:5173` and `http://127.0.0.1:5173`. Origins are matched exactly: if Vite
picks another port (5174 when 5173 is busy) or you use `vite preview` (4173), add that origin to `CORS_ORIGINS`.
For the frontend: `VITE_API_URL=http://localhost:8000/api/v1` (baked into the frontend build).

**Restart the API after any pipeline step that rewrites `data/`.** The grids are read on every request, but the
coefficients, outage months, uncertainty table, `last_date`, the validation report and `data_version` (which keys
the `/calendar` cache) are loaded once at start-up; without a restart a refreshed grid would be multiplied by the
old coefficients.

API documentation: http://localhost:8000/api/v1/docs. It shows `contract/openapi.yaml` itself (served at
`/api/v1/openapi.json` with the server URL `/api/v1`), not a schema generated from the routes: the contract is the
source of truth, and a generated schema would list 422 errors the API never sends and untyped responses.

Environment variables (`.env.example`): `DATA_DIR` (default: `data/` in the repository root), `POINTS_DIR`
(default: `DATA_DIR/points_serve`; the full `data/points` also works), `CORS_ORIGINS`,
`DUCKDB_MEMORY_LIMIT` (2GB), `DUCKDB_THREADS` (2).

`constraints.txt` pins the exact versions the tests pass with; CI installs with it. The pins are for Python 3.12,
the version CI tests, and `requires-python` is `>=3.12`.

## What is ready

| Endpoint | Status |
| --- | --- |
| `GET /health`, `GET /meta` | done |
| `POST /calendar`, `POST /export/calendar.csv` | done |
| `POST /current`, `POST /daily` | done |
| `POST /points`, `POST /export/points.csv` | done |
| `GET /method/validation` | done |

## How it works

- `app/geometry.py` — GeoJSON validation, area and the 0.1° cells whose centre lies inside the area. Edges are
  straight lines in longitude/latitude, as on the map; the geodesic area (WGS84) is measured on densified edges,
  so it is the area of the cells that are summed. An edge longer than 180° of longitude is rejected
  (`INVALID_GEOMETRY`): split areas that cross the antimeridian into a MultiPolygon at ±180°. Holes are
  subtracted whatever their winding. At most 5,000 vertices and 100 polygons; request bodies up to 1 MB.
- `app/series.py` — sum over the cells of the area: raw count of the lead source × the 1° cell coefficient
  (`data/coefficients.parquet`). The lead-source rule is the shared module `pipeline/lead.py`.
- `app/daily_service.py` — `/current`: accumulation since the 1st of the month against the same days of the baseline years; `/daily`: values by day of the year.
- `app/stats.py` — `percentile` is the mid-rank of the value among the baseline years (equal years count half),
  on values rounded to 0.1 as published; `category` is derived from that percentile with the contract's bands
  (below 25, 25–75, above 75 up to 90, above 90; `record` = above the baseline maximum, outside the baseline).
- `app/calendar_service.py` — medians and percentiles over the baseline years, categories, `low`/`high` intervals
  (`data/uncertainty.parquet`), yearly totals, trend (least squares), warnings.
- `app/points_service.py` — points from `points_serve/`: selection by date and bounding box in DuckDB (row-group skipping),
  then an exact polygon test; `harmonized_weight` is the 1° cell coefficient of the lead source (S-NPP — 1).
  `total` is exact. Above `max_points`, the 20,000 points with the highest FRP are returned with
  `truncated = true`. Rectangles use half-open bounds (west <= lon < east, south <= lat < north) like the grid,
  so a point on a shared edge belongs to one area. The CSV is streamed in a stable order.
- `/calendar` responses are cached in memory (the 200 most recent requests).
- Errors are always `{"error": {"code", "message"}}`, with CORS headers on every status including 500;
  request-body validation errors are returned as 400 `INVALID_REQUEST`.

## Checks (as in CI)

From `backend/`, with the virtual environment's tools (Windows: `..\.venv\Scripts\ruff`, `..\.venv\Scripts\pytest`):

```bash
../.venv/bin/ruff check .
../.venv/bin/ruff format --check .
../.venv/bin/pytest -q
```

The tests build tiny synthetic data folders (one ends on a month end in the Suomi NPP period, one in the middle
of a month in the NOAA-20 period), check every response against `contract/openapi.yaml` and assert exact numbers.
They ignore `DATA_DIR`, `POINTS_DIR`, `CORS_ORIGINS` and `DUCKDB_*` from the shell.
