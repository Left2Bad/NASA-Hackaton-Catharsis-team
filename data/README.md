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
│   └── api_2026/<sensor>/*.csv                2026 via the Area API (step 4)
├── points/<sensor>_<year>.parquet        # all detections in the common schema (step 1) — 7.1 GB
├── grid_daily.parquet                    # 0.1° cell × day: counts and FRP per satellite (step 2) — 680 MB
├── grid_monthly.parquet                  # the same by month (step 2) — 230 MB
├── coefficients.parquet                  # coefficients per 1° cell (step 3)
├── uncertainty.parquet                   # low/high intervals by value magnitude (step 3)
├── outage_months.csv                     # S-NPP outage months where NOAA-20 leads (step 3)
└── harmonized/
    ├── summary.json                          world coefficients, periods, validation metrics
    └── global_monthly.csv                    unified world series, for checks and the presentation
```

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
   `data/uncertainty.parquet`, `data/outage_months.csv`, `data/harmonized/summary.json` have appeared, and that in `summary.json`
   `global_coefficients.count_ta` ≈ 4.07.

This is enough for the backend (calendar, "Now", daily series, the "Method" page).
The archive has no detections (`data/points/`) — they are needed only for `/points` and the points CSV export; see option B.

### Option B — build everything yourself (~1.5 hours, ~20 GB of disk space, ≥12 GB RAM)

1. Environment: `python -m venv .venv`, then `.venv/Scripts/pip install -e "pipeline[dev]"` (Linux/macOS: `.venv/bin/pip`).
2. Check the free space: ≥ 20 GB is needed.
3. `python pipeline/download_archives.py` — 48 archives into `data/raw/`. No login is needed.
   If the server responds with anything other than 200 (FIRMS maintenance), tell the user and do not look for other sources.
4. `python pipeline/to_parquet.py data/raw/*.zip` — in a single process, not in parallel (memory).
5. `python pipeline/grid.py`, then `python pipeline/harmonize.py`.
6. Check: 48 files in `data/points/`; the output of `harmonize.py` contains the lines
   `S-NPP outage months: ['2022-07', '2022-08', '2024-07', '2024-11']` and `contract count_ta {'pearson_r': 0.99...`.

### 2026 (optional)

A free FIRMS key is needed: the user gets it themself at https://firms.modaps.eosdis.nasa.gov/api/map_key/
and puts it into `.env` (`FIRMS_MAP_KEY=...`, see `.env.example` for a template). Then:
`python pipeline/fetch_api.py` → `python pipeline/api_to_parquet.py` → `python pipeline/grid.py --years 2026` → `python pipeline/harmonize.py`.
The download takes 1.5–2.5 hours because of the key's rate limit (5000 transactions per 10 minutes); the script waits for the quota by itself.
Do not bypass the limit with several keys.
