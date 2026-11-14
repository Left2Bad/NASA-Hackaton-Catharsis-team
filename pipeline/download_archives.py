"""Step 0: download FIRMS yearly global archives ("Country Yearly Summary", all countries) into data/raw/.

48 files, ~9.3 GB: MODIS 2000-2025, VIIRS S-NPP 2012-2025, VIIRS NOAA-20 2018-2025. No login needed.
Resumable and safe to re-run: complete files are skipped by size, partial ones are resumed.
One writer per file (never run two copies of this script at the same time).
Usage: python pipeline/download_archives.py [--workers 4]
"""

import argparse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
BASE = "https://firms.modaps.eosdis.nasa.gov/data/country/zips"
FILES = (
    [f"modis_{y}_all_countries.zip" for y in range(2000, 2026)]
    + [f"viirs-snpp_{y}_all_countries.zip" for y in range(2012, 2026)]
    + [f"viirs-jpss1_{y}_all_countries.zip" for y in range(2018, 2026)]
)


def size_remote(url):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["Content-Length"])


def download(name):
    url, f = f"{BASE}/{name}", RAW / name
    for _attempt in range(6):
        try:
            want = size_remote(url)
            have = f.stat().st_size if f.exists() else 0
            if have == want:
                return f"OK   {name}"
            if have > want:  # corrupted (e.g. two writers) -> restart
                f.unlink()
                have = 0
            req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
            with urllib.request.urlopen(req, timeout=300) as r, open(f, "ab" if have else "wb") as out:
                while chunk := r.read(1 << 20):
                    out.write(chunk)
            if f.stat().st_size == want:
                return f"GOT  {name}"
        except Exception as e:
            print(f"retry {name}: {e}", flush=True)
    return f"FAIL {name}"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    RAW.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(ap.parse_args().workers) as ex:
        for line in ex.map(download, FILES):
            print(line, flush=True)
