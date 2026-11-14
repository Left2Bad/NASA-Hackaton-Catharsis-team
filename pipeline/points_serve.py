"""Step 7: lightweight copy of data/points for the server: only the columns /points and /export/points.csv need.

The full points (data/points, ~7.5 GB) stay on the workstation, the grids are built from them. The server gets
data/points_serve/<src>_<year>.parquet with the same rows and these columns:

  lat, lon, acq_date, acq_time (HHMM, UTC), satellite (contract codes T/A/N/N20), sensor, source,
  conf_class (l/n/h), frp, pixel_km2 (= scan * track, 2 decimals), daynight, type, quality (SP/NRT)

Dropped: bright, bright2, conf_raw, scan, track, country. Yearly archives have no `quality` column, they are
standard processing (SP). Rows are sorted by acq_date, lat, so a month and a latitude band read only a few row
groups. Files are converted strictly one at a time (large VIIRS years need several GB of memory) and each output
is checked to have the same number of rows as its source.

Usage: python pipeline/points_serve.py [--only viirs-snpp_2021 ...] [--force]
"""

import argparse
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
POINTS = DATA / "points"
OUT = DATA / "points_serve"
TMP = DATA / "_tmp"

# data/points keeps MODIS satellites as 'Terra'/'Aqua'; the contract uses T/A/N/N20 (N21 reserved)
SATELLITE_SQL = "CASE satellite WHEN 'Terra' THEN 'T' WHEN 'Aqua' THEN 'A' ELSE satellite END"
SATELLITES = {"T", "A", "N", "N20", "N21"}


def connect(memory_limit: str = "4GB") -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    spill = (TMP / "spill_points_serve").as_posix()
    con.execute(f"SET memory_limit='{memory_limit}'; SET threads=4; SET temp_directory='{spill}'")
    return con


def columns(con: duckdb.DuckDBPyConnection, path: Path) -> set[str]:
    return {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path.as_posix()}')").fetchall()}


def select_sql(src: str, has_quality: bool) -> str:
    quality = "coalesce(quality, 'SP')" if has_quality else "'SP'"
    return f"""
      SELECT lat, lon, acq_date, acq_time, ({SATELLITE_SQL}) AS satellite, sensor, source, conf_class, frp,
             round(scan * track, 2)::FLOAT AS pixel_km2, daynight, type, ({quality}) AS quality
      FROM read_parquet('{src}')
      ORDER BY acq_date, lat"""


def convert(con: duckdb.DuckDBPyConnection, src: Path, out_dir: Path = OUT) -> tuple[Path, int]:
    """Write the lightweight copy of one points file; returns (output path, rows). Raises if row counts differ."""
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / src.name
    part = dst.with_suffix(".parquet.part")
    sql = select_sql(src.as_posix(), "quality" in columns(con, src))
    con.execute(
        f"COPY ({sql}) TO '{part.as_posix()}' "
        "(FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9, ROW_GROUP_SIZE 250000)"
    )
    n_src = con.execute(f"SELECT count(*) FROM read_parquet('{src.as_posix()}')").fetchone()[0]
    n_dst = con.execute(f"SELECT count(*) FROM read_parquet('{part.as_posix()}')").fetchone()[0]
    if n_src != n_dst:
        part.unlink()
        raise RuntimeError(f"{src.name}: {n_dst} rows written, source has {n_src}")
    bad = con.execute(f"SELECT DISTINCT satellite FROM read_parquet('{part.as_posix()}')").fetchall()
    unknown = {r[0] for r in bad} - SATELLITES
    if unknown:
        part.unlink()
        raise RuntimeError(f"{src.name}: unknown satellite codes {sorted(map(str, unknown))}")
    part.replace(dst)
    return dst, n_dst


def is_done(con: duckdb.DuckDBPyConnection, src: Path, out_dir: Path = OUT) -> bool:
    dst = out_dir / src.name
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
        return False
    count = "SELECT count(*) FROM read_parquet('{}')"
    return (
        con.execute(count.format(src.as_posix())).fetchone()[0]
        == con.execute(count.format(dst.as_posix())).fetchone()[0]
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="file stems, e.g. viirs-snpp_2021")
    ap.add_argument("--force", action="store_true", help="rebuild files that are already up to date")
    ap.add_argument("--memory-limit", default="4GB")
    a = ap.parse_args()
    con = connect(a.memory_limit)
    files = sorted(POINTS.glob("*.parquet"))
    if a.only:
        files = [f for f in files if f.stem in set(a.only)]
    t_all, rows_all = time.perf_counter(), 0
    for src in files:  # strictly one file at a time: large VIIRS years need several GB
        if not a.force and is_done(con, src):
            print(f"{src.name}: up to date", flush=True)
            continue
        t = time.perf_counter()
        dst, n = convert(con, src)
        rows_all += n
        print(
            f"{src.name}: {n:,} rows, {src.stat().st_size / 2**20:.0f} -> {dst.stat().st_size / 2**20:.0f} MB, "
            f"{time.perf_counter() - t:.0f} s",
            flush=True,
        )
    size = sum(f.stat().st_size for f in OUT.glob("*.parquet")) if OUT.exists() else 0
    print(
        f"total: {len(list(OUT.glob('*.parquet')))} files, {size / 2**30:.2f} GB; converted {rows_all:,} rows "
        f"in {time.perf_counter() - t_all:.0f} s",
        flush=True,
    )


if __name__ == "__main__":
    main()
