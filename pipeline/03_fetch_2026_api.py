"""Step 3: fetch current-year (2026) hotspots from FIRMS Area API, whole world, in 5-day chunks.

Uses standard-processing (SP) data where available, NRT after that (per /api/data_availability).
Output: data/api_2026/<SOURCE>/<start>.csv  -> then converted to data/parquet/<src>_2026.parquet
Usage: put FIRMS_MAP_KEY into .env (or env var), then  python 03_fetch_2026_api.py
Resumable: existing chunk files are skipped. Respects FIRMS limit (5000 transactions / 10 min).
"""
import csv, io, os, sys, time, urllib.request
from datetime import date, timedelta
from pathlib import Path

def _env_key():
    """Read FIRMS_MAP_KEY from the repo-root .env file (see .env.example)."""
    env = Path(__file__).resolve().parents[1] / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("FIRMS_MAP_KEY="):
                return line.split("=", 1)[1].strip() or None
    return None


KEY = os.environ.get("FIRMS_MAP_KEY") or _env_key() or sys.exit("set FIRMS_MAP_KEY")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "api_2026"
BASE = "https://firms.modaps.eosdis.nasa.gov/api"
YEAR_START = date(2026, 1, 1)
# our source name -> (SP product, NRT product)
SOURCES = {"modis": ("MODIS_SP", "MODIS_NRT"),
           "viirs-snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
           "viirs-jpss1": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT")}


def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return r.read().decode()
        except Exception as e:
            print("  retry", i, e, flush=True); time.sleep(30 * (i + 1))
    raise RuntimeError(url)


def availability():
    rows = csv.DictReader(io.StringIO(get(f"{BASE}/data_availability/csv/{KEY}/all")))
    return {r["data_id"]: (date.fromisoformat(r["min_date"]), date.fromisoformat(r["max_date"])) for r in rows}


def status():
    try: return get(f"https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY={KEY}")
    except Exception: return "?"


def wait_quota(limit=3500):
    """Block while the MAP_KEY has used more than `limit` of its 5000 transactions / 10 min."""
    import json
    while True:
        try:
            used = json.loads(status())["current_transactions"]
        except Exception:
            used = 0
        if used < limit:
            return
        print(f"  quota {used}/5000, waiting 60s", flush=True); time.sleep(60)


def fetch(task):
    src, d, n, prod = task
    f = OUT / src / f"{d}_{prod}.csv"
    if f.exists():
        return
    f.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(10):
        wait_quota()
        try:
            txt = get(f"{BASE}/area/csv/{KEY}/{prod}/world/{n}/{d}", tries=2)
        except RuntimeError:
            continue
        if txt.startswith("latitude"):
            break
        print("  unexpected:", src, d, txt[:200], flush=True); time.sleep(120)
    else:
        print("FAIL", src, d, flush=True); return
    tmp = f.with_suffix(".tmp"); tmp.write_text(txt); tmp.replace(f)   # atomic
    print(f"{src} {d} +{n}d {prod} rows={txt.count(chr(10)) - 1}", flush=True)


def main():
    from concurrent.futures import ThreadPoolExecutor
    av = availability()
    print("availability:", {k: (str(a), str(b)) for k, (a, b) in av.items() if k in sum(SOURCES.values(), ())})
    tasks = []
    for src, (sp, nrt) in SOURCES.items():
        d = YEAR_START
        while True:
            prod = sp if sp in av and av[sp][0] <= d <= av[sp][1] else nrt
            if prod not in av or d > av[prod][1]:
                break
            n = min(5, (av[prod][1] - d).days + 1)
            tasks.append((src, d, n, prod))
            d += timedelta(days=n)
    print("chunks:", len(tasks), flush=True)
    with ThreadPoolExecutor(int(os.environ.get("FIRMS_WORKERS", 6))) as ex:
        list(ex.map(fetch, tasks))
    print("DONE", status())


if __name__ == "__main__":
    main()
