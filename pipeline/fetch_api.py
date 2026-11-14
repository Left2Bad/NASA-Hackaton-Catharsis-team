"""Step 4: fetch current-year (2026) hotspots from the FIRMS Area API, whole world, in 5-day chunks.

Uses standard-processing (SP) data where available and near real time (NRT) after that (per /api/data_availability).
Output: data/raw/api_2026/<source>/<first>_<last>_<PRODUCT>.csv, one file per chunk, plus data/raw/api_2026/fetch.json
(start time of the run and the availability it saw). Step 5 (api_to_parquet.py) turns the chunks into
data/points/<source>_2026.parquet.

Usage: put FIRMS_MAP_KEY into .env (see .env.example) or the environment, then  python pipeline/fetch_api.py
Safe to re-run: chunks have a fixed 5-day grid from 1 January, and each file name states the days it covers.
A chunk is skipped only when that exact file exists and is final (SP, or NRT fetched at least 6 hours after its last
day ended); the open NRT tail is fetched again on every run. Superseded files may stay on disk: step 5 reads each day
from one chunk only (SP first, then the newest). Any chunk that still fails after the retries is listed at the end and
the script exits with code 1. The key is never printed: URLs in messages are redacted.
Respects the FIRMS limit (5000 transactions / 10 min) by waiting for the quota.
"""

import argparse
import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "api_2026"
BASE = "https://firms.modaps.eosdis.nasa.gov/api"
YEAR_START = dt.date(2026, 1, 1)
CHUNK_DAYS = 5
FINAL_AFTER = dt.timedelta(hours=6)  # an NRT day is complete ~3 hours after the last overpass; keep a margin
# our source name -> (SP product, NRT product)
SOURCES = {
    "modis": ("MODIS_SP", "MODIS_NRT"),
    "viirs-snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
    "viirs-jpss1": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
}


def _env_key():
    """Read FIRMS_MAP_KEY from the repo-root .env file (see .env.example)."""
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("FIRMS_MAP_KEY="):
                return line.split("=", 1)[1].strip() or None
    return None


KEY = os.environ.get("FIRMS_MAP_KEY") or _env_key()


def redact(text) -> str:
    """The text with the MAP_KEY replaced: for every message, error and log line."""
    s = str(text)
    return s.replace(KEY, "<key>") if KEY else s


def get(url, tries=6, pause=30):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return r.read().decode()
        except Exception as e:
            print("  retry", i, redact(e), flush=True)
            if i + 1 < tries:
                time.sleep(pause * (i + 1))
    raise RuntimeError(f"request failed after {tries} tries: {redact(url)}") from None


def availability():
    rows = csv.DictReader(io.StringIO(get(f"{BASE}/data_availability/csv/{KEY}/all")))
    return {r["data_id"]: (dt.date.fromisoformat(r["min_date"]), dt.date.fromisoformat(r["max_date"])) for r in rows}


def status():
    try:
        return get(f"https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY={KEY}", tries=1)
    except Exception:
        return "?"


def wait_quota(limit=3500):
    """Block while the MAP_KEY has used more than `limit` of its 5000 transactions / 10 min."""
    while True:
        try:
            used = json.loads(status())["current_transactions"]
        except Exception:
            used = 0
        if used < limit:
            return
        print(f"  quota {used}/5000, waiting 60s", flush=True)
        time.sleep(60)


def plan(av: dict, year_start: dt.date = YEAR_START) -> tuple[list[tuple], list[str]]:
    """Chunks to fetch as (source, first, last, product) on a fixed 5-day grid, and the day ranges nobody serves.

    A day is fetched as SP when the SP product covers it, otherwise as NRT; a chunk that straddles the end of SP is
    split into an SP and an NRT part, so the grid never shifts between runs.
    """
    tasks, problems = [], []
    for src, (sp, nrt) in SOURCES.items():
        products = [p for p in (sp, nrt) if p in av]
        if not products:
            problems.append(f"{src}: no product in data_availability")
            continue
        last = max(av[p][1] for p in products)
        start = year_start
        while start <= last:
            end = min(start + dt.timedelta(days=CHUNK_DAYS - 1), last)
            d = start
            while d <= end:
                prod = next((p for p in products if av[p][0] <= d <= av[p][1]), None)
                if prod is None:
                    problems.append(f"{src}: {d} is in no product's availability")
                    d += dt.timedelta(days=1)
                    continue
                seg_end = min(end, av[prod][1])
                tasks.append((src, d, seg_end, prod))
                d = seg_end + dt.timedelta(days=1)
            start += dt.timedelta(days=CHUNK_DAYS)
    return tasks, problems


def chunk_path(src, first, last, prod, out=OUT) -> Path:
    return out / src / f"{first}_{last}_{prod}.csv"


def is_final(path: Path, last: dt.date, prod: str) -> bool:
    """SP chunks are final; an NRT chunk only if it was fetched FINAL_AFTER after its last day ended."""
    if not path.exists():
        return False
    if not prod.endswith("_NRT"):
        return True
    fetched = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.UTC)
    return fetched - FINAL_AFTER >= dt.datetime.combine(last + dt.timedelta(days=1), dt.time(), dt.UTC)


def fetch(task, out=OUT, attempts=10) -> str | None:
    """Fetch one chunk; returns None on success (or skip), else a description of the failure."""
    src, first, last, prod = task
    f = chunk_path(src, first, last, prod, out)
    if is_final(f, last, prod):
        return None
    f.parent.mkdir(parents=True, exist_ok=True)
    n = (last - first).days + 1
    for _ in range(attempts):
        wait_quota()
        try:
            txt = get(f"{BASE}/area/csv/{KEY}/{prod}/world/{n}/{first}", tries=2)
        except RuntimeError:
            continue
        if txt.startswith("latitude"):
            break
        print("  unexpected:", src, first, redact(txt[:200]), flush=True)
        time.sleep(120)
    else:
        print("FAIL", src, first, last, prod, flush=True)
        return f"{src} {first}..{last} {prod}"
    tmp = f.with_suffix(".tmp")
    tmp.write_text(txt, encoding="utf-8")
    tmp.replace(f)  # atomic
    print(f"{src} {first}..{last} {prod} rows={txt.count(chr(10)) - 1}", flush=True)
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fetch 2026 FIRMS hotspots (whole world) through the Area API.")
    ap.add_argument("--workers", type=int, default=int(os.environ.get("FIRMS_WORKERS", 6)), help="parallel requests")
    ap.add_argument("--dry-run", action="store_true", help="print the chunk plan and exit")
    a = ap.parse_args(argv)
    if not KEY:
        sys.exit("set FIRMS_MAP_KEY in .env or environment")
    started = dt.datetime.now(dt.UTC)
    try:
        av = availability()
    except RuntimeError as e:
        sys.exit(f"FIRMS data_availability is not reachable ({e}); try again later")
    wanted = sum(SOURCES.values(), ())
    print("availability:", {k: (str(lo), str(hi)) for k, (lo, hi) in av.items() if k in wanted}, flush=True)
    tasks, problems = plan(av)
    todo = [t for t in tasks if not is_final(chunk_path(*t), t[2], t[3])]
    print(f"chunks: {len(tasks)}, to fetch: {len(todo)}", flush=True)
    if a.dry_run:
        for t in todo:
            print(" ", t[0], t[1], t[2], t[3])
        return 0
    with ThreadPoolExecutor(a.workers) as ex:
        failed = [r for r in ex.map(fetch, todo) if r]
    manifest = {
        "started_at": started.isoformat(timespec="seconds"),
        "availability": {k: [str(lo), str(hi)] for k, (lo, hi) in av.items() if k in wanted},
        "failed": failed,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "fetch.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if failed or problems:
        print("\n".join(["NOT COMPLETE:", *problems, *failed]), flush=True)
        return 1
    print("DONE", redact(status()), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
