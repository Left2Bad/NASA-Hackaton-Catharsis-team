"""Pack the "fast path" data archive: every file the backend needs, from a full data folder, without the raw archives
and the 7.6 GB of detections (data/README.md, option A).

Paths inside the zip start with data/, so unpacking it in the repository root gives the layout of data/README.md.
Parquet files are already compressed (zstd), so they are stored, not deflated again. The source folder is only read.

    python pack_data.py --src ../data --zip ../FIRMS_data_2026-11-13.zip

Hotspot points (data/points_serve/, 5.7 GB, needed only for /points and the points CSV export) are not included;
--with-points adds them, which needs a host that takes files larger than 2 GB (a GitHub release asset does not).
"""

import argparse
import zipfile
from pathlib import Path

# the backend's files (backend/app/data.py), the harmonize/validation outputs and the static mask (for re-running grid)
MANIFEST = [
    "grid_daily.parquet",
    "grid_monthly.parquet",
    "grid_daily_gap_months.parquet",
    "coefficients.parquet",
    "uncertainty.parquet",
    "static_mask.parquet",
    "outage_months.csv",
    "gap_days.csv",
    "harmonized/summary.json",
    "harmonized/global_monthly.csv",
    "validation/report.json",
    "validation/checks.json",
]
REQUIRED = ["grid_daily.parquet", "grid_monthly.parquet", "coefficients.parquet", "harmonized/summary.json"]


def files_to_pack(src: Path, with_points: bool = False) -> list[Path]:
    missing = [name for name in REQUIRED if not (src / name).exists()]
    if missing:
        raise FileNotFoundError(f"missing in {src}: {', '.join(missing)}")
    files = [src / name for name in MANIFEST if (src / name).exists()]
    if with_points:
        files += sorted((src / "points_serve").glob("*.parquet"))
    return files


def pack(src: Path, zip_path: Path, with_points: bool = False) -> list[tuple[str, int]]:
    """Write the zip; return (path in the archive, size in bytes) per file."""
    listed = []
    with zipfile.ZipFile(zip_path, "w", allowZip64=True) as z:
        for f in files_to_pack(src, with_points):
            arcname = (Path("data") / f.relative_to(src)).as_posix()
            kind = zipfile.ZIP_STORED if f.suffix == ".parquet" else zipfile.ZIP_DEFLATED
            z.write(f, arcname, compress_type=kind)
            listed.append((arcname, f.stat().st_size))
    return listed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=Path("../data"), help="full data folder (read only)")
    ap.add_argument("--zip", type=Path, required=True, help="archive to write")
    ap.add_argument("--with-points", action="store_true", help="also pack points_serve/ (5.7 GB)")
    ap.add_argument("--dry-run", action="store_true", help="only list the files and their sizes")
    args = ap.parse_args()
    if args.dry_run:
        listed = [
            (f.relative_to(args.src).as_posix(), f.stat().st_size) for f in files_to_pack(args.src, args.with_points)
        ]
    else:
        listed = pack(args.src, args.zip, args.with_points)
    for name, size in listed:
        print(f"{size / 1e6:10.1f} MB  {name}")
    print(f"{sum(s for _, s in listed) / 1e6:10.1f} MB  total, {len(listed)} files")
    if not args.dry_run:
        print(f"{args.zip}: {args.zip.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
