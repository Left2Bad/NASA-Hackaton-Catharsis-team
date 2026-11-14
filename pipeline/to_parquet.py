"""Step 1: FIRMS yearly zips -> unified Parquet (one file per sensor/year).

Unified columns:
  lat, lon, acq_date (DATE), acq_time (HHMM int), satellite, sensor (MODIS|VIIRS),
  source (modis|viirs-snpp|viirs-jpss1), conf_class (l|n|h), conf_raw (str),
  bright (MODIS brightness / VIIRS bright_ti4), bright2 (T31 / ti5), frp, scan, track,
  daynight, type, country
MODIS numeric confidence -> class: <30 l, 30..79 n, >=80 h (FIRMS convention).

Usage: python pipeline/to_parquet.py [<zip or glob pattern> ...]
Without arguments all archives data/raw/*_all_countries.zip are converted. Glob patterns are expanded by the script
itself, so `data/raw/*.zip` works in PowerShell and cmd as well as in bash. Existing outputs are skipped.
Run one process at a time: large VIIRS years need ~9 GB of memory.
"""

import argparse
import glob
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "points"
NAME = re.compile(r"^(modis|viirs-snpp|viirs-jpss1)_(\d{4})_")
TMP = ROOT / "data" / "_tmp"


def convert(zp: Path):
    src, year = zp.name.split("_")[0], zp.name.split("_")[1]
    out = OUT / f"{src}_{year}.parquet"
    if out.exists():
        print("skip", out.name, flush=True)
        return
    TMP.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(dir=TMP))
    try:
        zipfile.ZipFile(zp).extractall(tmp)
        csvs = str(tmp / "**" / "*.csv").replace("\\", "/")
        is_modis = src == "modis"
        b1, b2 = ("brightness", "bright_t31") if is_modis else ("bright_ti4", "bright_ti5")
        conf_cls = (
            "CASE WHEN TRY_CAST(confidence AS INT) < 30 THEN 'l' "
            "WHEN TRY_CAST(confidence AS INT) < 80 THEN 'n' ELSE 'h' END"
            if is_modis
            else "lower(substr(CAST(confidence AS VARCHAR),1,1))"
        )
        con = duckdb.connect()
        con.execute(
            f"SET threads=8; SET memory_limit='9GB'; SET preserve_insertion_order=false; SET temp_directory='{(TMP / 'spill').as_posix()}'"
        )
        part = out.with_suffix(".part")
        con.execute(f"""
        COPY (
          SELECT CAST(latitude AS FLOAT) lat, CAST(longitude AS FLOAT) lon,
                 CAST(acq_date AS DATE) acq_date, CAST(acq_time AS SMALLINT) acq_time,
                 CAST(satellite AS VARCHAR) satellite,
                 '{"MODIS" if is_modis else "VIIRS"}' sensor, '{src}' source,
                 {conf_cls} conf_class, CAST(confidence AS VARCHAR) conf_raw,
                 CAST({b1} AS FLOAT) bright, CAST({b2} AS FLOAT) bright2,
                 CAST(frp AS FLOAT) frp, CAST(scan AS FLOAT) scan, CAST(track AS FLOAT) track,
                 CAST(daynight AS VARCHAR) daynight, CAST(type AS TINYINT) type,
                 regexp_extract(filename, '_\\d{{4}}_(.+)\\.csv$', 1) country
          FROM read_csv('{csvs}', filename=true, union_by_name=true, all_varchar=true, header=true)
          ORDER BY acq_date
        ) TO '{part.as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 500000)
        """)
        n = con.execute(f"SELECT count(*) FROM read_parquet('{part.as_posix()}')").fetchone()[0]
        part.rename(out)
        print(f"done {out.name} rows={n:,}", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def expand(patterns: list[str]) -> list[Path]:
    """Archive paths from file names and glob patterns; every pattern must match something."""
    out = []
    for p in patterns:
        hits = sorted(glob.glob(p)) if glob.has_magic(p) else [p]
        if not hits:
            raise SystemExit(f"no files match {p}")
        out += [Path(h) for h in hits]
    bad = [f.name for f in out if not NAME.match(f.name)]
    if bad:
        raise SystemExit(f"not a FIRMS yearly archive name (<sensor>_<year>_...zip): {', '.join(bad)}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Convert FIRMS yearly archives into data/points/<sensor>_<year>.parquet.")
    ap.add_argument("zips", nargs="*", help="archives or glob patterns (default: data/raw/*_all_countries.zip)")
    a = ap.parse_args(argv)
    files = expand(a.zips) if a.zips else sorted(RAW.glob("*_all_countries.zip"))
    if not files:
        raise SystemExit(f"no archives in {RAW}: run pipeline/download_archives.py first")
    OUT.mkdir(parents=True, exist_ok=True)
    for f in files:
        convert(f)


if __name__ == "__main__":
    main(sys.argv[1:])
