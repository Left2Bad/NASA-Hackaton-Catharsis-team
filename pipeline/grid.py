"""Daily and monthly hotspot grids built from data/points.

One row per (cell, day) with raw counts and FRP per satellite, after the standard filters
(type = 0 vegetation fire, confidence not low). Harmonized values are computed downstream as
raw count of the lead source x coefficient of the 1-degree cell, so one table serves days and months.

Cell index: iy = floor((lat + 90) / STEP), ix = floor((lon + 180) / STEP); cell centre =
(iy + 0.5) * STEP - 90, (ix + 0.5) * STEP - 180.

Outputs (sorted by iy, ix, date so readers can skip row groups outside a latitude band):
  data/grid_daily.parquet    iy, ix, date,  n_t, n_a, n_snpp, n_n20, f_t, f_a, f_snpp, f_n20
  data/grid_monthly.parquet  iy, ix, month, same columns
Usage: python pipeline/grid.py [--step 0.1] [--years 2020 2021 ...]
"""

import argparse
import re
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
POINTS = DATA / "points"
TMP = DATA / "_tmp"
STEP = 0.1

# satellite codes as stored in data/points: MODIS 'Terra'/'Aqua', VIIRS S-NPP 'N', NOAA-20 'N20'
AGG = """
    count(*) FILTER (WHERE source = 'modis' AND satellite IN ('Terra', 'T'))::INTEGER AS n_t,
    count(*) FILTER (WHERE source = 'modis' AND satellite IN ('Aqua', 'A'))::INTEGER  AS n_a,
    count(*) FILTER (WHERE source = 'viirs-snpp')::INTEGER                            AS n_snpp,
    count(*) FILTER (WHERE source = 'viirs-jpss1')::INTEGER                           AS n_n20,
    coalesce(sum(frp) FILTER (WHERE source = 'modis' AND satellite IN ('Terra', 'T')), 0)::FLOAT AS f_t,
    coalesce(sum(frp) FILTER (WHERE source = 'modis' AND satellite IN ('Aqua', 'A')), 0)::FLOAT  AS f_a,
    coalesce(sum(frp) FILTER (WHERE source = 'viirs-snpp'), 0)::FLOAT                            AS f_snpp,
    coalesce(sum(frp) FILTER (WHERE source = 'viirs-jpss1'), 0)::FLOAT                           AS f_n20
"""
SUMS = """
    sum(n_t)::INTEGER AS n_t, sum(n_a)::INTEGER AS n_a, sum(n_snpp)::INTEGER AS n_snpp, sum(n_n20)::INTEGER AS n_n20,
    sum(f_t)::FLOAT AS f_t, sum(f_a)::FLOAT AS f_a, sum(f_snpp)::FLOAT AS f_snpp, sum(f_n20)::FLOAT AS f_n20
"""


def connect():
    con = duckdb.connect()
    spill = (TMP / "spill").as_posix()
    con.execute(f"SET memory_limit='8GB'; SET preserve_insertion_order=false; SET temp_directory='{spill}'")
    return con


def available_years(points=POINTS):
    return sorted(
        {int(m.group(1)) for p in points.glob("*.parquet") if (m := re.search(r"_(\d{4})\.parquet$", p.name))}
    )


def build_year(con, year, step=STEP, points=POINTS, out_dir=TMP / "grid_daily"):
    """Aggregate one year of points into daily cells; returns the part file path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{year}.parquet"
    src = (points / f"*_{year}.parquet").as_posix()
    con.execute(f"""
    COPY (
      SELECT floor((lat + 90) / {step})::SMALLINT AS iy, floor((lon + 180) / {step})::SMALLINT AS ix,
             acq_date AS date, {AGG}
      FROM read_parquet('{src}')
      WHERE type = 0 AND conf_class <> 'l'
      GROUP BY ALL
    ) TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    return out


def combine(con, parts_glob, data=DATA):
    """Merge per-year parts into the sorted daily and monthly grids."""
    daily, monthly = data / "grid_daily.parquet", data / "grid_monthly.parquet"
    con.execute(f"""
    COPY (SELECT * FROM read_parquet('{parts_glob}') ORDER BY iy, ix, date)
    TO '{daily.with_suffix(".part").as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 1000000)""")
    daily.with_suffix(".part").replace(daily)
    con.execute(f"""
    COPY (SELECT iy, ix, date_trunc('month', date)::DATE AS month, {SUMS}
          FROM read_parquet('{daily.as_posix()}') GROUP BY ALL ORDER BY iy, ix, month)
    TO '{monthly.with_suffix(".part").as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 1000000)""")
    monthly.with_suffix(".part").replace(monthly)
    return daily, monthly


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=float, default=STEP)
    ap.add_argument("--years", type=int, nargs="*")
    ap.add_argument("--no-combine", action="store_true", help="only build per-year parts")
    a = ap.parse_args()
    con = connect()
    parts = TMP / "grid_daily"
    for y in a.years or available_years():
        p = build_year(con, y, a.step, out_dir=parts)
        n = con.execute(f"SELECT count(*) FROM read_parquet('{p.as_posix()}')").fetchone()[0]
        print(f"{y}: {n:,} rows, {p.stat().st_size / 2**20:.1f} MB", flush=True)
    if not a.no_combine:
        daily, monthly = combine(con, (parts / "*.parquet").as_posix())
        for f in (daily, monthly):
            print(f"{f.name}: {f.stat().st_size / 2**20:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
