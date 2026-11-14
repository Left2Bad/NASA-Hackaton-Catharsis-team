"""Step 2: daily and monthly hotspot grids built from data/points.

One row per (cell, day) with raw counts and FRP per satellite, after the standard filters:
  * type = 0 (presumed vegetation fire) and confidence not low;
  * the static-source mask, applied to every sensor alike: ~0.01-degree (~1 km) cells where any sensor's archive
    (2000-2025) has a type 1 (volcano), 2 (static land source) or 3 (offshore) detection are dropped for all sensors.
    FIRMS types the same source differently in MODIS and VIIRS (Holuhraun 2014: MODIS type 2, VIIRS type 0), and a
    one-sided filter would make the MODIS -> VIIRS ratio explode there (docs/methodology.md, section 3).
Harmonized values are computed downstream as raw count of the lead source x coefficient of the 1-degree cell, so one
table serves days and months.

Cell index: iy = floor((lat + 90) / STEP), ix = floor((lon + 180) / STEP); cell centre =
(iy + 0.5) * STEP - 90, (ix + 0.5) * STEP - 180.

Outputs (sorted by iy, ix, date so readers can skip row groups outside a latitude band):
  data/static_mask.parquet   ky, kx (round(lat * 100), round(lon * 100)), type — built once from the archive years
  data/grid_parts/<year>.parquet   per-year parts (incremental cache: keep it, a later --years run reuses it)
  data/grid_daily.parquet    iy, ix, date,  n_t, n_a, n_snpp, n_n20, f_t, f_a, f_snpp, f_n20
  data/grid_monthly.parquet  iy, ix, month, same columns
The full grids are only written when every year in data/points has an up-to-date part (same step and mask, newer
than its points files); missing or stale parts are rebuilt first, so `--years 2026` never drops the other years.

Usage: python pipeline/grid.py [--step 0.1] [--years 2026 ...] [--no-combine] [--rebuild-mask]
"""

import argparse
import datetime as dt
import re
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
POINTS = DATA / "points"
PARTS = DATA / "grid_parts"
TMP = DATA / "_tmp"
STEP = 0.1
MASK_LAST_YEAR = 2025  # the mask uses standard-processing archive years only, so a 2026 refresh does not change it

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


def mask_key(alias: str = "") -> tuple[str, str]:
    """Mask cell of a point: the same expressions for the mask and for the points it filters."""
    a = f"{alias}." if alias else ""
    return f"round({a}lat * 100)::INTEGER", f"round({a}lon * 100)::INTEGER"


def connect(data=DATA):
    con = duckdb.connect()
    spill = (data / "_tmp" / "spill").as_posix()
    con.execute(f"SET memory_limit='8GB'; SET preserve_insertion_order=false; SET temp_directory='{spill}'")
    return con


def available_years(points=POINTS):
    return sorted(
        {int(m.group(1)) for p in points.glob("*.parquet") if (m := re.search(r"_(\d{4})\.parquet$", p.name))}
    )


def kv_metadata(con, path: Path) -> dict[str, str]:
    rows = con.execute(f"SELECT key::VARCHAR, value::VARCHAR FROM parquet_kv_metadata('{path.as_posix()}')").fetchall()
    return dict(rows)


def mask_files(points=POINTS):
    return [p for p in sorted(points.glob("*.parquet")) if (y := re.search(r"_(\d{4})\.parquet$", p.name))
            and int(y.group(1)) <= MASK_LAST_YEAR]  # fmt: skip


def build_mask(con, points=POINTS, out=DATA / "static_mask.parquet", force=False) -> Path:
    """~1 km cells where any sensor reported a volcano, static or offshore source in the archive years.

    Rebuilt when missing, when forced, or when an archive points file is newer than the mask.
    """
    files = mask_files(points)
    if not force and out.exists() and all(f.stat().st_mtime <= out.stat().st_mtime for f in files):
        return out
    if not files:
        raise SystemExit(f"no archive points (<= {MASK_LAST_YEAR}) in {points} to build the static-source mask")
    src = "[" + ", ".join(f"'{f.as_posix()}'" for f in files) + "]"
    built = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    part = out.with_suffix(".part")
    ky, kx = mask_key()
    con.execute(f"""
    COPY (SELECT {ky} AS ky, {kx} AS kx, max(type)::TINYINT AS type
          FROM read_parquet({src}, union_by_name=true)
          WHERE type IN (1, 2, 3) AND year(acq_date) <= {MASK_LAST_YEAR}
          GROUP BY ALL ORDER BY ky, kx)
    TO '{part.as_posix()}' (FORMAT parquet, KV_METADATA {{built_at: '{built}'}})""")
    part.replace(out)
    n = con.execute(f"SELECT count(*) FROM read_parquet('{out.as_posix()}')").fetchone()[0]
    print(f"static-source mask: {n:,} cells of ~1 km from {len(files)} archive files", flush=True)
    return out


def mask_id(con, mask: Path) -> str:
    return kv_metadata(con, mask).get("built_at", "")


def build_year(con, year, step=STEP, points=POINTS, out_dir=PARTS, mask=None):
    """Aggregate one year of points into daily cells; returns the part file path.

    `mask` is the static-source mask file (build_mask); None applies no mask (tests only).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{year}.parquet"
    src = (points / f"*_{year}.parquet").as_posix()
    ky, kx = mask_key("p")
    anti = f"ANTI JOIN read_parquet('{mask.as_posix()}') m ON m.ky = {ky} AND m.kx = {kx}" if mask else ""
    meta = f"step: '{step}', mask: '{mask_id(con, mask) if mask else ''}'"
    part = out.with_suffix(".part")
    con.execute(f"""
    COPY (
      SELECT floor((lat + 90) / {step})::SMALLINT AS iy, floor((lon + 180) / {step})::SMALLINT AS ix,
             acq_date AS date, {AGG}
      FROM (SELECT lat, lon, acq_date, satellite, source, frp FROM read_parquet('{src}', union_by_name=true)
            WHERE type = 0 AND conf_class <> 'l') p {anti}
      GROUP BY ALL
    ) TO '{part.as_posix()}' (FORMAT parquet, COMPRESSION zstd, KV_METADATA {{{meta}}})""")
    part.replace(out)
    return out


def part_is_current(con, year, step, mask, points=POINTS, parts=PARTS) -> bool:
    """The part exists, was built with this step and mask, and is newer than every points file of its year."""
    p = parts / f"{year}.parquet"
    if not p.exists():
        return False
    meta = kv_metadata(con, p)
    if meta.get("step") != str(step) or meta.get("mask") != (mask_id(con, mask) if mask else ""):
        return False
    return all(f.stat().st_mtime <= p.stat().st_mtime for f in points.glob(f"*_{year}.parquet"))


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


def run(years=None, step=STEP, combine_parts=True, rebuild_mask=False, data=DATA, points=None, parts=None):
    """Build the requested years (default: all) plus every missing or stale part, then combine all parts."""
    points = points or data / "points"
    parts = parts or data / "grid_parts"
    con = connect(data)
    mask = build_mask(con, points, data / "static_mask.parquet", force=rebuild_mask)
    every = available_years(points)
    if not every:
        raise SystemExit(f"no points in {points}: run to_parquet.py first")
    unknown = sorted(set(years or []) - set(every))
    if unknown:
        raise SystemExit(f"no points for years {unknown} in {points}")
    todo = sorted(set(years or every) | {y for y in every if not part_is_current(con, y, step, mask, points, parts)})
    for y in todo:
        p = build_year(con, y, step, points=points, out_dir=parts, mask=mask)
        n = con.execute(f"SELECT count(*) FROM read_parquet('{p.as_posix()}')").fetchone()[0]
        print(f"{y}: {n:,} rows, {p.stat().st_size / 2**20:.1f} MB", flush=True)
    if not combine_parts:
        return None
    stray = sorted(int(p.stem) for p in parts.glob("*.parquet") if p.stem.isdigit() and int(p.stem) not in every)
    if stray:
        raise SystemExit(f"{parts} has parts for years without points: {stray}; delete them or restore the points")
    missing = [y for y in every if not part_is_current(con, y, step, mask, points, parts)]
    if missing:  # cannot happen after the loop above unless a points file changed meanwhile
        raise SystemExit(f"parts are missing or stale for {missing}; the full grids were not replaced")
    daily, monthly = combine(con, (parts / "*.parquet").as_posix(), data=data)
    for f in (daily, monthly):
        print(f"{f.name}: {f.stat().st_size / 2**20:.1f} MB", flush=True)
    return daily, monthly


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build data/grid_daily.parquet and data/grid_monthly.parquet.")
    ap.add_argument("--step", type=float, default=STEP, help="cell size in degrees (default 0.1)")
    ap.add_argument(
        "--years", type=int, nargs="*", help="rebuild these years (missing or stale parts are always rebuilt)"
    )
    ap.add_argument("--no-combine", action="store_true", help="only build per-year parts")
    ap.add_argument("--rebuild-mask", action="store_true", help="rebuild data/static_mask.parquet (then all parts)")
    a = ap.parse_args(argv)
    run(a.years, a.step, not a.no_combine, a.rebuild_mask)


if __name__ == "__main__":
    main()
