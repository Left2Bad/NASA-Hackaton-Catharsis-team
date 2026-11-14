"""Step 5: API CSV chunks (data/raw/api_2026, step 4) -> data/points/<src>_2026.parquet, same schema as step 1.

Safe to re-run after any number of fetch runs:
 * every chunk file declares the days it covers: `<first>_<last>_<PRODUCT>.csv` (fetch_api.py), or the older
   `<first>_<PRODUCT>.csv`, whose last day is the day before the next chunk of the same source;
 * each day is taken from exactly one chunk: standard processing (SP) is preferred over near real time (NRT), and among
   chunks of the same quality the most recently fetched one wins. Overlapping chunks therefore never double-count, and
   NRT days that SP now covers are replaced by SP;
 * the run fails (exit code 1) if a day between 1 January and the last fetched day is covered by no chunk
   (a failed or missing chunk), instead of writing a silent hole. Days that are covered but hold no detections
   (for example Suomi NPP after 2 November 2026, or a sensor outage) are only reported.

API CSVs have no `country` column; SP chunks carry `type`, NRT chunks do not, so:
 * type: the SP value when present; otherwise points in a cell of the static-source mask (grid.py: ~1 km cells where
   the 2000-2025 archive has a type 1, 2 or 3 detection) get that type; everything else = 0;
 * country: NULL (the API does not report it and nothing downstream needs it);
 * quality: 'SP' or 'NRT', from the chunk's product.

Also writes data/points/api_<year>.json: when the data was fetched, the last day of standard processing and the last
complete day per source. The day of the fetch is still being filled by FIRMS, so a day counts as complete only when the
fetch started at least COMPLETE_AFTER after the day ended. harmonize.py copies these dates into summary.json.

Usage: python pipeline/api_to_parquet.py [--allow-holes]
"""

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

import duckdb

import grid

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
YEAR = 2026
SOURCES = ["modis", "viirs-snpp", "viirs-jpss1"]
COMPLETE_AFTER = dt.timedelta(hours=6)  # NRT data reach FIRMS within ~3 hours of the overpass
NEW_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})_([A-Z0-9_]+)\.csv$")
OLD_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})_([A-Z0-9_]+)\.csv$")


def chunk_files(folder: Path, con=None) -> list[dict]:
    """Chunk files of one source with the days they cover: [{path, first, last, quality, mtime}]."""
    chunks, old = [], []
    for f in sorted(folder.glob("*.csv")):
        if m := NEW_NAME.match(f.name):
            first, last, prod = dt.date.fromisoformat(m[1]), dt.date.fromisoformat(m[2]), m[3]
        elif m := OLD_NAME.match(f.name):
            first, last, prod = dt.date.fromisoformat(m[1]), None, m[2]
        else:
            print(f"  skipping {f.name}: not a chunk file name", flush=True)
            continue
        quality = "NRT" if prod.endswith("_NRT") else "SP"
        c = {"path": f, "first": first, "last": last, "quality": quality, "mtime": f.stat().st_mtime}
        (old if last is None else chunks).append(c)
    old.sort(key=lambda c: c["first"])
    for c, nxt in zip(old, old[1:] + [None], strict=True):
        if nxt is not None:
            c["last"] = nxt["first"] - dt.timedelta(days=1)
        else:  # the last chunk of an old-style run: its data end where it ends
            con = con or duckdb.connect()
            d = con.execute(
                f"SELECT max(CAST(acq_date AS DATE)) FROM read_csv('{c['path'].as_posix()}', all_varchar=true, header=true)"
            ).fetchone()[0]
            c["last"] = d or c["first"]
    return sorted(chunks + old, key=lambda c: (c["first"], c["mtime"]))


def pick_days(chunks: list[dict], year_start: dt.date) -> tuple[dict[dt.date, dict], list[tuple[dt.date, dt.date]]]:
    """For each day the chunk it is read from (SP first, then the latest fetch), and the uncovered day ranges."""
    best: dict[dt.date, dict] = {}
    for c in chunks:
        d = max(c["first"], year_start)
        while d <= c["last"]:
            cur = best.get(d)
            rank = (c["quality"] == "SP", c["mtime"], c["last"])
            if cur is None or rank > (cur["quality"] == "SP", cur["mtime"], cur["last"]):
                best[d] = c
            d += dt.timedelta(days=1)
    holes, d = [], year_start
    last = max(best, default=year_start - dt.timedelta(days=1))
    while d <= last:
        if d not in best:
            start = d
            while d + dt.timedelta(days=1) <= last and d + dt.timedelta(days=1) not in best:
                d += dt.timedelta(days=1)
            holes.append((start, d))
        d += dt.timedelta(days=1)
    return best, holes


def fetch_time(raw: Path, picked: dict[str, dict[dt.date, dict]]) -> dt.datetime:
    """Start of the fetch run (fetch_api.py writes fetch.json); else the earliest fetch of a source's last chunk."""
    manifest = raw / "fetch.json"
    if manifest.exists():
        return dt.datetime.fromisoformat(json.loads(manifest.read_text(encoding="utf-8"))["started_at"])
    stamps = [days[max(days)]["mtime"] for days in picked.values() if days]
    return dt.datetime.fromtimestamp(min(stamps), dt.UTC)


def complete_through(fetched_at: dt.datetime) -> dt.date:
    """The last day that had ended at least COMPLETE_AFTER before the fetch started."""
    return (fetched_at.astimezone(dt.UTC) - COMPLETE_AFTER).date() - dt.timedelta(days=1)


def convert(con, src: str, days: dict[dt.date, dict], out: Path, mask: Path) -> tuple:
    is_modis = src == "modis"
    b1, b2 = ("brightness", "bright_t31") if is_modis else ("bright_ti4", "bright_ti5")
    conf = (
        "CASE WHEN TRY_CAST(confidence AS INT) < 30 THEN 'l' WHEN TRY_CAST(confidence AS INT) < 80 THEN 'n' ELSE 'h' END"
        if is_modis
        else "lower(substr(CAST(confidence AS VARCHAR),1,1))"
    )
    files = sorted({c["path"].as_posix() for c in days.values()})
    con.execute("CREATE OR REPLACE TEMP TABLE pick (filename VARCHAR, day DATE, quality VARCHAR)")
    con.executemany(
        "INSERT INTO pick VALUES (?, ?, ?)", [(c["path"].as_posix(), d, c["quality"]) for d, c in days.items()]
    )
    file_list = "[" + ", ".join(f"'{f}'" for f in files) + "]"
    part = out.with_suffix(".part")
    con.execute(f"""
    COPY (
      WITH r AS (SELECT * FROM read_csv({file_list}, all_varchar=true, header=true, union_by_name=true, filename=true)),
           p AS (SELECT DISTINCT r.* EXCLUDE (filename), pick.quality
                 FROM r JOIN pick ON pick.filename = replace(r.filename, '\\', '/')
                                 AND pick.day = CAST(r.acq_date AS DATE))
      SELECT CAST(latitude AS FLOAT) lat, CAST(longitude AS FLOAT) lon, CAST(acq_date AS DATE) acq_date,
             CAST(acq_time AS SMALLINT) acq_time,
             CASE CAST(satellite AS VARCHAR) WHEN 'T' THEN 'Terra' WHEN 'A' THEN 'Aqua' ELSE CAST(satellite AS VARCHAR) END satellite,
             '{"MODIS" if is_modis else "VIIRS"}' sensor, '{src}' source,
             {conf} conf_class, CAST(confidence AS VARCHAR) conf_raw,
             CAST({b1} AS FLOAT) bright, CAST({b2} AS FLOAT) bright2, CAST(frp AS FLOAT) frp,
             CAST(scan AS FLOAT) scan, CAST(track AS FLOAT) track, CAST(daynight AS VARCHAR) daynight,
             CAST(coalesce(TRY_CAST(p.type AS TINYINT), m.type, 0) AS TINYINT) type,
             NULL::VARCHAR country, p.quality
      FROM p
      LEFT JOIN read_parquet('{mask.as_posix()}') m
        ON m.ky = round(CAST(latitude AS FLOAT) * 100)::INTEGER AND m.kx = round(CAST(longitude AS FLOAT) * 100)::INTEGER
      ORDER BY acq_date
    ) TO '{part.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    part.replace(out)
    return con.execute(
        f"SELECT count(*), min(acq_date), max(acq_date), count(*) FILTER (WHERE type <> 0), "
        f"count(DISTINCT acq_date) FROM read_parquet('{out.as_posix()}')"
    ).fetchone()


def main(argv=None, data=DATA, year=YEAR):
    ap = argparse.ArgumentParser(
        description=f"Convert the FIRMS API chunks of {year} into data/points/*_{year}.parquet."
    )
    ap.add_argument("--allow-holes", action="store_true", help="write the files even if some days have no chunk")
    a = ap.parse_args(argv)
    raw, points = data / "raw" / f"api_{year}", data / "points"
    points.mkdir(parents=True, exist_ok=True)
    con = grid.connect(data)
    year_start = dt.date(year, 1, 1)
    picked, problems = {}, []
    for src in SOURCES:
        chunks = chunk_files(raw / src, con)
        if not chunks:
            print("no chunk files for", src, flush=True)
            continue
        picked[src], holes = pick_days(chunks, year_start)
        for h0, h1 in holes:
            problems.append(f"{src}: no chunk covers {h0} .. {h1}")
    if problems:
        print("\n".join(problems), flush=True)
        if not a.allow_holes:
            sys.exit("missing chunks: re-run fetch_api.py (or pass --allow-holes to write the files anyway)")
    mask = grid.build_mask(con, points, data / "static_mask.parquet")
    fetched_at = fetch_time(raw, picked)
    through = complete_through(fetched_at)
    coverage = {"year": year, "fetched_at": fetched_at.isoformat(timespec="seconds"), "complete_through": str(through)}
    coverage["sources"] = {}
    for src, days in picked.items():
        out = points / f"{src}_{year}.parquet"
        n, d0, d1, n_static, n_days = convert(con, src, days, out, mask)
        sp = [d for d, c in days.items() if c["quality"] == "SP"]
        with_rows = {
            r[0] for r in con.execute(f"SELECT DISTINCT acq_date FROM read_parquet('{out.as_posix()}')").fetchall()
        }
        empty = sorted(d for d in days if d not in with_rows)
        coverage["sources"][src] = {
            "first_date": str(min(days)),
            "last_date": str(max(days)),
            "last_sp_date": str(max(sp)) if sp else None,
            "last_complete_date": str(min(max(days), through)),
            "rows": n,
            "days_without_rows": [str(d) for d in empty],
        }
        print(f"{src}: {n:,} rows, {d0} .. {d1}, {n_days} days with data, {n_static:,} static", flush=True)
        if empty:
            print(f"  covered days without detections: {', '.join(map(str, empty))}", flush=True)
    (points / f"api_{year}.json").write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
    print(f"fetched at {fetched_at:%Y-%m-%d %H:%M} UTC; complete days through {through}", flush=True)
    return coverage


if __name__ == "__main__":
    main()
