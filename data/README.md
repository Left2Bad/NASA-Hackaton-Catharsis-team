# data/

The data folder. Only this file goes into git: everything else in `data/` is excluded in `.gitignore`.
Data source: NASA FIRMS (https://www.earthdata.nasa.gov/data/tools/firms).

## Layout

```text
data/
├── raw/                                  # FIRMS archives (step 0) — 48 zips, 9.3 GB
│   ├── modis_<year>_all_countries.zip         2000–2025
│   ├── viirs-snpp_<year>_all_countries.zip    2012–2025
│   ├── viirs-jpss1_<year>_all_countries.zip   2018–2025 (NOAA-20)
│   └── api_2026/<sensor>/<first>_<last>_<PRODUCT>.csv   2026 via the Area API (step 4), plus fetch.json
├── points/<sensor>_<year>.parquet        # all detections in the common schema (steps 1 and 5) — 7.6 GB with 2026
├── points/api_2026.json                  # when 2026 was fetched; last standard-processing and last complete day (step 5)
├── points_serve/<sensor>_<year>.parquet  # lightweight copy of the points for /points and the CSV export (step 7) — 5.7 GB
├── static_mask.parquet                   # ~1 km cells with volcano / static / offshore detections in any sensor (step 2)
├── grid_parts/<year>.parquet             # per-year parts of the daily grid, an incremental cache — keep it (step 2)
├── grid_daily.parquet                    # 0.1° cell × day: counts and FRP per satellite (step 2) — ~740 MB
├── grid_monthly.parquet                  # the same by month (step 2) — ~250 MB
├── coefficients.parquet                  # coefficients per 1° cell (step 3)
├── uncertainty.parquet                   # low/high intervals by value magnitude (step 3)
├── outage_months.csv                     # S-NPP outage months where NOAA-20 leads the whole month (step 3)
├── gap_days.csv                          # days when one satellite did not report (step 3), format below
├── grid_daily_gap_months.parquet         # grid rows of the months with filled gap days, for the backend (step 3)
├── harmonized/
│   ├── summary.json                          world coefficients, periods, validation metrics, data dates, gap summary
│   └── global_monthly.csv                    unified world series, for checks and the presentation
└── validation/
    ├── report.json                           the "Method" page report (contract schema ValidationResponse, step 6)
    └── checks.json                           checks the contract has no field for: 2002 seam, region baselines (step 6)
```

`data/_tmp/` holds DuckDB spill files and can be deleted at any time.

### Sensor gaps: `outage_months.csv` and `gap_days.csv`

`outage_months.csv` (`month,snpp_per_n20`) keeps its old meaning and format: months where the world-wide Suomi NPP /
NOAA-20 ratio is below 85 % of its median; NOAA-20 leads the whole month.

`gap_days.csv` (`date,sensor,ratio`) lists days when one satellite delivered (almost) nothing while the others reported
normally: `date` is `YYYY-MM-DD`, `sensor` is `terra`, `aqua`, `snpp` or `n20`, and `ratio` is that day's world-wide count
relative to normal (0 = no detections at all). A day is a gap when the sensor's daily ratio to another sensor falls below
a quarter (MODIS) or a half (VIIRS) of its median over the surrounding 31 days. On a gap day of the lead satellite the
backend and the pipeline use another one where possible (Suomi NPP → NOAA-20, or MODIS before NOAA-20; Aqua → Terra);
a Terra gap in 2000–2012 cannot be filled. Every month with a gap day of its lead satellite is returned with
`sensor_gap = true`. `harmonized/summary.json` repeats the counts (`gap_days`) and the flagged months (`sensor_gap_months`).

### Data dates in `harmonized/summary.json`

`last_date` is the last day in the grids, `last_complete_date` the last day whose data were complete when fetched (the
fetch day itself is partial and is not served), `last_standard_date` the last day of standard processing (later days are
near real time and `preliminary`), `sensor_last_dates` the last day with detections per satellite. The backend reads them
from here; data folders made before these keys existed fall back to the grid and the points files.

---

## Instructions for an AI assistant (Claude Code, etc.): how to prepare the data

The goal is to get exactly the layout above in `data/`. Work from the repository root.
Do not commit anything from `data/`. Do not commit keys or `.env`.

### Option A — a ready-made team archive is available (fast, ~5 minutes)

The team shares a data archive (`FIRMS_data_*.zip`, ~1 GB) via Google Drive. The user downloads it themself
and gives you the path to the file. Inside the archive, paths are relative to the repository root and all start with `data/`.

1. Check the archive: `python -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip())" <path>` → `None`.
2. Extract into the repository root only the paths that start with `data/`:

   ```bash
   python -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); [z.extract(n,'.') for n in z.namelist() if n.startswith('data/')]" <path>
   ```

3. Check that `data/grid_daily.parquet`, `data/grid_monthly.parquet`, `data/coefficients.parquet`,
   `data/uncertainty.parquet`, `data/outage_months.csv`, `data/gap_days.csv`, `data/grid_daily_gap_months.parquet`,
   `data/harmonized/summary.json` have appeared, and that in `summary.json` `global_coefficients.count_ta` ≈ 4.04 and
   `last_complete_date` is set.

This is enough for the backend (calendar, "Now", daily series, the "Method" page).
The archive has no detections (`data/points/`, `data/points_serve/`) — they are needed only for `/points` and the points
CSV export; see option B. The backend takes the data dates from `summary.json`, so near-real-time months stay marked as
preliminary without the points files.

### Option B — build everything yourself (~1.5 hours, ~20 GB of disk space, ≥12 GB RAM)

Commands run from the repository root, one per line; they work in Windows PowerShell and in bash.

1. Environment: `python -m venv .venv`, activate it (PowerShell: `.venv\Scripts\Activate.ps1`; Git Bash:
   `source .venv/Scripts/activate`; Linux/macOS: `source .venv/bin/activate`), then `pip install -e "pipeline[dev]"`.
2. Check the free space: ≥ 20 GB is needed.
3. `python pipeline/download_archives.py` — 48 archives into `data/raw/`. No login is needed.
   If the server responds with anything other than 200 (FIRMS maintenance), tell the user and do not look for other sources.
4. `python pipeline/to_parquet.py` — all archives in `data/raw/`, in a single process, not in parallel (memory).
5. `python pipeline/grid.py`, then `python pipeline/harmonize.py`, then `python pipeline/validation.py`.
6. Optional, for `/points` and the points CSV export: `python pipeline/points_serve.py` (~11 minutes).
7. Check: 48 files in `data/points/`; the output of `harmonize.py` contains the lines
   `S-NPP outage months: ['2022-07', '2022-08', '2024-07', '2024-11']` and `contract count_ta {'pearson_r': 0.99...`.

### 2026 (optional)

A free FIRMS key is needed: the user gets it themself at https://firms.modaps.eosdis.nasa.gov/api/map_key/
and puts it into `.env` (`FIRMS_MAP_KEY=...`, see `.env.example` for a template). Then:
`python pipeline/fetch_api.py` → `python pipeline/api_to_parquet.py` → `python pipeline/grid.py --years 2026` →
`python pipeline/harmonize.py` → `python pipeline/validation.py` →
`python pipeline/points_serve.py --only modis_2026 viirs-snpp_2026 viirs-jpss1_2026`.
Re-running the chain later is safe: `fetch_api.py` refetches only unfinished chunks, `api_to_parquet.py` reads each day
from one chunk and stops if a day is missing, and `grid.py --years 2026` rebuilds any missing yearly part before it
replaces the full grids.
The download takes 1.5–2.5 hours because of the key's rate limit (5000 transactions per 10 minutes); the script waits for the quota by itself.
Do not bypass the limit with several keys.
