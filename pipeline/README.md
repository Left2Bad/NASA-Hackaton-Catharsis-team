# pipeline/ — developer A zone

The data pipeline: from the NASA FIRMS archives to a single harmonized series. Method and metrics — `docs/methodology.md`.
How to get the ready-made data without recomputing everything — `data/README.md`.

## Running from scratch

```bash
python -m venv .venv
.venv/Scripts/pip install -e "pipeline[dev]"     # Linux/macOS: .venv/bin/pip
```

| Step | Command | Result | Time |
| --- | --- | --- | --- |
| 0. Download archives | `python pipeline/download_archives.py` | `data/raw/*.zip` (48 files, 9.3 GB) | ~1 h |
| 1. Common schema | `python pipeline/to_parquet.py data/raw/*.zip` | `data/points/<sensor>_<year>.parquet` (7.1 GB) | ~20 min |
| 2. Grids | `python pipeline/grid.py` | `data/grid_daily.parquet`, `data/grid_monthly.parquet` (0.1° cell) | ~5 min |
| 3. Harmonization | `python pipeline/harmonize.py` | `data/coefficients.parquet`, `data/uncertainty.parquet`, `data/outage_months.csv`, `data/harmonized/` | ~10 s |
| 4. 2026 via the API | `python pipeline/fetch_api.py` (needs `FIRMS_MAP_KEY` in `.env`) | `data/raw/api_2026/` | 1.5–2.5 h, bounded by the key's rate limit |
| 5. 2026 → Parquet | `python pipeline/api_to_parquet.py`, then `grid.py --years 2026` and steps 3 and 6 again | `data/points/*_2026.parquet` | ~2 min |
| 6. Validation report | `python pipeline/validation.py` (after step 3) | `data/validation/report.json` (schema `ValidationResponse`) | ~1 s |

- Run step 1 in **a single process**: the large VIIRS years (≈20 million detections) need ~9 GB of RAM.
- Steps 0 and 4 can be restarted: finished files are skipped, partial downloads are resumed.
  Do not run two copies of the same step at once — they would corrupt each other's files.

## Differences from the original plan

- The 0.1° daily grid (`grid.py`) is the basis for the API: raw counts and FRP per satellite per cell and day,
  already after the filters. Harmonized value = lead-source count × the 1° cell coefficient.
- The lead source for a date is `lead.py` (`lead_source`, `lead_sql`, `value_sql`); the backend imports the same module.
- The MODIS coefficients are fitted on 2012–2020 (before the Terra and Aqua orbit drift), see `docs/methodology.md`, section 4.
- Permanent sources: the archives already have a `type` field (1 — volcanoes, 2 — static, 3 — offshore), and we filter on it.
  For the 2026 NRT data without `type`, the mask is built from the archive (step 5).

## Checks (as in CI)

```bash
cd pipeline
ruff check . && ruff format --check . && pytest -q
```

The tests run on tiny synthetic archives; no real data is needed for them.
