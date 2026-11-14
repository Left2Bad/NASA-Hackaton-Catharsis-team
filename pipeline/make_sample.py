"""Cut a small, self-contained sample DATA_DIR from a full data folder, so the app runs without the ~20 GB rebuild.

The sample keeps every file the backend reads (see backend/app/data.py and data/README.md), with the large grids and
hotspot points cut to a few regions. By default these are the three preset regions of the app (the same boxes as
backend/app/schemas.py PRESETS and pipeline/validation.py REGIONS), with a 0.5-degree margin, over the full history
2000 to the last day of the data, so the baseline years and the current year both work.

Kept as is (small, world-wide): coefficients.parquet, uncertainty.parquet, outage_months.csv, gap_days.csv,
harmonized/summary.json, harmonized/global_monthly.csv, validation/report.json, validation/checks.json.
Cut to the regions: grid_daily.parquet, grid_monthly.parquet, grid_daily_gap_months.parquet (0.1-degree cells inside
the boxes) and points_serve/<sensor>_<year>.parquet (detections inside the boxes, years from --points-from on, default 2021).
summary.json gets a "sample" key that records what was cut.

summary.json also gets the covered 0.1-degree cell ranges: the backend answers NO_DATA for an area that is not fully
inside them (instead of zero fire), and /points answers NO_DATA for years before --points-from. The world coefficients
and the "Method" page are the full-data ones.

The source folder is only read. Usage:

    python make_sample.py --src ../data --out ../sample_data --zip ../burn-calendar-sample-data.zip
"""

import argparse
import json
import math
import shutil
import zipfile
from pathlib import Path

import duckdb

STEP = 0.1  # grid step, degrees (grid.py)

# (id, west, south, east, north): the app's preset regions
PRESETS = [
    ("kz-steppe", 61.0, 51.0, 71.0, 55.0),
    ("amazon-south", -62.0, -13.0, -52.0, -7.0),
    ("california-north", -124.0, 38.5, -120.0, 42.0),
]

# small files copied unchanged; the backend starts without the optional ones but serves less
COPY_FILES = [
    "coefficients.parquet",
    "uncertainty.parquet",
    "outage_months.csv",
    "gap_days.csv",
    "harmonized/global_monthly.csv",
    "validation/report.json",
    "validation/checks.json",
]
REQUIRED = ["grid_daily.parquet", "grid_monthly.parquet", "coefficients.parquet"]


def cell_ranges(box: tuple[float, float, float, float], margin: float) -> tuple[int, int, int, int]:
    """Inclusive iy/ix index ranges of the 0.1-degree cells that touch the box widened by margin."""
    west, south, east, north = box
    eps = 1e-9  # 109.5 / 0.1 is 1094.999... in floating point
    iy0 = max(0, math.floor((south - margin + 90) / STEP + eps))
    iy1 = min(1799, math.ceil((north + margin + 90) / STEP - eps) - 1)
    ix0 = max(0, math.floor((west - margin + 180) / STEP + eps))
    ix1 = min(3599, math.ceil((east + margin + 180) / STEP - eps) - 1)
    return iy0, iy1, ix0, ix1


def grid_filter(boxes, margin: float) -> str:
    parts = []
    for box in boxes:
        iy0, iy1, ix0, ix1 = cell_ranges(box, margin)
        parts.append(f"(iy BETWEEN {iy0} AND {iy1} AND ix BETWEEN {ix0} AND {ix1})")
    return " OR ".join(parts)


def point_filter(boxes, margin: float) -> str:
    parts = []
    for west, south, east, north in boxes:
        parts.append(
            f"(lat >= {south - margin} AND lat < {north + margin} AND lon >= {west - margin} AND lon < {east + margin})"
        )
    return " OR ".join(parts)


def make_sample(src: Path, out: Path, boxes, margin: float = 0.5, points_from: int = 2000) -> dict:
    """Write the sample into out (which must not exist or be empty) and return the "sample" summary block."""
    src, out = Path(src), Path(out)
    for name in REQUIRED:
        if not (src / name).exists():
            raise FileNotFoundError(f"{src / name} not found: point --src at a full data folder")
    if out.exists() and any(out.iterdir()):
        raise FileExistsError(f"{out} is not empty; remove it or choose another --out")
    if out.resolve() == src.resolve():
        raise ValueError("--out must differ from --src")
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(f"SET temp_directory='{(out / '_tmp').as_posix()}'")

    cells = grid_filter(boxes, margin)
    grids = {"grid_daily": "iy, ix, date", "grid_monthly": "iy, ix, month", "grid_daily_gap_months": "iy, ix, date"}
    rows = {}
    for name, order in grids.items():
        path = src / f"{name}.parquet"
        if not path.exists():
            continue
        # same order and compression as grid.py, so row-group pruning by iy works as on the full data
        con.execute(f"""
        COPY (SELECT * FROM read_parquet('{path.as_posix()}') WHERE {cells} ORDER BY {order})
        TO '{(out / f"{name}.parquet").as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)""")
        rows[name] = con.execute(f"SELECT count(*) FROM '{(out / f'{name}.parquet').as_posix()}'").fetchone()[0]

    for name in COPY_FILES:
        if (src / name).exists():
            (out / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src / name, out / name)

    points_rows = 0
    points_src = src / "points_serve"
    if points_src.exists():
        (out / "points_serve").mkdir()
        where = point_filter(boxes, margin)
        for f in sorted(points_src.glob("*_*.parquet")):
            year = int(f.stem.rsplit("_", 1)[1])
            if year < points_from:
                continue
            target = out / "points_serve" / f.name
            con.execute(f"""
            COPY (SELECT * FROM read_parquet('{f.as_posix()}') WHERE {where} ORDER BY acq_date, lat, lon)
            TO '{target.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
            points_rows += con.execute(f"SELECT count(*) FROM '{target.as_posix()}'").fetchone()[0]

    con.close()
    shutil.rmtree(out / "_tmp", ignore_errors=True)

    sample = {
        "boxes": [list(b) for b in boxes],
        "margin_deg": margin,
        "cell_ranges": [list(cell_ranges(b, margin)) for b in boxes],  # backend/app/data.py: NO_DATA outside them
        "points_from_year": points_from,
        "rows": {**rows, "points_serve": points_rows},
        "note": "Grids and points cover only these boxes; coefficients and validation are the full-data ones.",
    }
    summary_src = src / "harmonized" / "summary.json"
    summary = json.loads(summary_src.read_text(encoding="utf-8")) if summary_src.exists() else {}
    summary["sample"] = sample
    (out / "harmonized").mkdir(exist_ok=True)
    (out / "harmonized" / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return sample


def write_zip(folder: Path, zip_path: Path) -> None:
    """Zip the folder with its name as the top directory (unzip next to the repo, then DATA_DIR=./<name>)."""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.rglob("*")):
            if f.is_file():
                z.write(f, Path(folder.name) / f.relative_to(folder))


def parse_box(text: str) -> tuple[float, float, float, float]:
    west, south, east, north = (float(v) for v in text.split(","))
    if not (west < east and south < north):
        raise argparse.ArgumentTypeError(f"bad box {text!r}: expected west,south,east,north")
    return west, south, east, north


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=Path("../data"), help="full data folder (read only)")
    ap.add_argument("--out", type=Path, default=Path("../sample_data"), help="new sample folder (must be empty)")
    ap.add_argument(
        "--box",
        type=parse_box,
        action="append",
        help="west,south,east,north in degrees; repeat for several boxes (default: the three preset regions)",
    )
    ap.add_argument("--margin", type=float, default=0.5, help="degrees added around each box (default 0.5)")
    ap.add_argument("--points-from", type=int, default=2021, help="first year of hotspot points to keep (default 2021)")
    ap.add_argument("--zip", type=Path, help="also write the sample folder into this zip file")
    args = ap.parse_args()
    boxes = args.box or [b[1:] for b in PRESETS]
    sample = make_sample(args.src, args.out, boxes, args.margin, args.points_from)
    size = sum(f.stat().st_size for f in args.out.rglob("*") if f.is_file())
    print(json.dumps(sample["rows"]), f"{size / 1e6:.1f} MB in {args.out}")
    if args.zip:
        write_zip(args.out, args.zip)
        print(f"{args.zip}: {args.zip.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
