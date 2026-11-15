# pipeline/

The data pipeline: from the NASA FIRMS archives to a single harmonized series. Method and metrics — `docs/methodology.md`.
How to get the ready-made data without recomputing everything — `data/README.md`.

## Running from scratch

Commands run from the repository root, one per line, in Windows PowerShell or bash. Create the environment once and
activate it in every new terminal (PowerShell: `.venv\Scripts\Activate.ps1`; Git Bash: `source .venv/Scripts/activate`;
Linux/macOS: `source .venv/bin/activate`):

```bash
python -m venv .venv
```

```bash
pip install -e "pipeline[dev]"
```

| Step | Command | Result | Time |
| --- | --- | --- | --- |
| 0. Download archives | `python pipeline/download_archives.py` | `data/raw/*.zip` (48 files, 9.3 GB) | ~1 h |
| 1. Common schema | `python pipeline/to_parquet.py` | `data/points/<sensor>_<year>.parquet` (7.1 GB for the archives) | ~20 min |
| 2. Grids | `python pipeline/grid.py` | `data/static_mask.parquet`, `data/grid_parts/`, `data/grid_daily.parquet` (~740 MB), `data/grid_monthly.parquet` (~250 MB) | ~5 min |
| 3. Harmonization | `python pipeline/harmonize.py` | `data/coefficients.parquet`, `data/uncertainty.parquet`, `data/outage_months.csv`, `data/gap_days.csv`, `data/grid_daily_gap_months.parquet`, `data/harmonized/` | ~15 s |
| 4. 2026 via the API | `python pipeline/fetch_api.py` (needs `FIRMS_MAP_KEY` in `.env` or the environment) | `data/raw/api_2026/<sensor>/<first>_<last>_<PRODUCT>.csv`, `fetch.json` | 1.5–2.5 h, bounded by the key's rate limit |
| 5. 2026 → Parquet | `python pipeline/api_to_parquet.py` | `data/points/<sensor>_2026.parquet`, `data/points/api_2026.json` | ~2 min |
| 6. Validation report | `python pipeline/validation.py` (after step 3) | `data/validation/report.json` (schema `ValidationResponse`), `data/validation/checks.json` | ~10 s |
| 7. Points for the server | `python pipeline/points_serve.py` | `data/points_serve/<sensor>_<year>.parquet` (5.7 GB) for `/points` and the points CSV export | ~11 min |
| Release: sample data | `python pipeline/make_sample.py --src data --out sample_data --zip burn-calendar-sample-data.zip` | the three example regions, 53 MB zipped (data/README.md, "Sample data") | ~30 s |
| Release: data archive | `python pipeline/pack_data.py --src data --zip FIRMS_data_<last day>.zip` | the files the backend needs, 1.03 GB (data/README.md, option A) | seconds |

`to_parquet.py` without arguments converts every `data/raw/*_all_countries.zip`; it also takes file names or patterns
(`python pipeline/to_parquet.py data/raw/modis_*.zip`) and expands them itself, so patterns work in PowerShell and cmd.
Every script has `--help`, which only prints the options.

**Refreshing 2026** (after the archive build above): steps 4 and 5, then

```bash
python pipeline/grid.py --years 2026
```

```bash
python pipeline/harmonize.py
```

```bash
python pipeline/validation.py
```

```bash
python pipeline/points_serve.py --only modis_2026 viirs-snpp_2026 viirs-jpss1_2026
```

- Run step 1 in **a single process**: the large VIIRS years (≈20 million detections) need ~9 GB of RAM.
- Steps 0 and 4 can be restarted. Step 0 skips complete files and resumes partial ones. Step 4 keeps a fixed 5-day chunk
  grid from 1 January; finished chunks (standard processing, or near real time fetched at least 6 hours after their last
  day) are skipped and the open tail is fetched again; a chunk that keeps failing is listed and the run exits with code 1.
  The FIRMS key is never printed or written to a file.
- Step 5 takes every day from exactly one chunk (standard processing first, then the newest fetch), so overlapping chunks
  from several runs never double-count, and it stops with exit code 1 when a day is covered by no chunk. It records when
  the data were fetched: the fetch day is still incomplete, so `last_complete_date` is the day before.
- Step 2 keeps one part per year in `data/grid_parts/` (with the cell size and the mask in the file metadata). `--years`
  rebuilds those years, and any missing or stale part is rebuilt too, so the full grids are never replaced by a partial set.
- Do not run two copies of the same step at once — they would corrupt each other's files.

## Design notes

- The 0.1° daily grid (`grid.py`) is the basis for the API: raw counts and FRP per satellite per cell and day,
  already after the filters. Harmonized value = lead-source count × the 1° cell coefficient.
- The lead source for a date is `lead.py` (`lead_source`, `lead_sql`, `value_sql`); the backend imports the same module.
  On sensor gap days (`data/gap_days.csv`) the lead source is replaced day by day (Suomi NPP → NOAA-20, Aqua → Terra).
- The MODIS coefficients are fitted on 2012–2020 (before the Terra and Aqua orbit drift), see `docs/methodology.md`, section 4.
- Permanent sources: the archives have a `type` field (1 — volcanoes, 2 — static, 3 — offshore), but MODIS and VIIRS
  type the same source differently (Holuhraun 2014: MODIS type 2, VIIRS type 0). `grid.py` therefore builds one static-source
  mask (~1 km cells where any sensor reported types 1–3 in 2000–2025) and applies it to every sensor; the same mask gives
  a type to the 2026 near-real-time detections, which have no `type` field.

## Checks (as in CI)

With the environment active, in `pipeline/`:

```bash
ruff check .
```

```bash
ruff format --check .
```

```bash
pytest -q
```

The tests run on tiny synthetic data; no real data or FIRMS key is needed for them.
