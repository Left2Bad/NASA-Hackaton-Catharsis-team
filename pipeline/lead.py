"""Which sensor leads the harmonized series on a given date. Single source of truth for pipeline and backend.

Periods (docs/methodology.md, section 5):
  MODIS_T     2000-11-01 .. 2002-07-31   MODIS Terra only (Aqua data starts 2002-07-04)
  MODIS_TA    2002-08-01 .. 2012-01-31   MODIS Terra + Aqua
  VIIRS_SNPP  2012-02-01 .. SNPP_END     reference sensor, no conversion
  VIIRS_N20   SNPP_END+1 .. today        NOAA-20 x coefficient
NOAA-20 also replaces S-NPP in S-NPP outage months (data/outage_months.csv, found by harmonize.py).
"""

import csv
import datetime as dt
from pathlib import Path

FIRST_DATE = dt.date(2000, 11, 1)
AQUA_START = dt.date(2002, 8, 1)
SNPP_START = dt.date(2012, 2, 1)
SNPP_END = dt.date(2026, 10, 31)  # S-NPP stops reporting in early November 2026 (FIRMS data availability)
N20_FIRST = dt.date(2018, 4, 1)  # first month of NOAA-20 standard data

LABELS = {
    "MODIS_T": "MODIS Terra × коэффициент",
    "MODIS_TA": "MODIS Terra + Aqua × коэффициент",
    "VIIRS_SNPP": "VIIRS Suomi NPP (эталон)",
    "VIIRS_N20": "VIIRS NOAA-20 × коэффициент",
}

PERIODS = [  # (id, start, end) — end None means "until now"
    ("MODIS_T", FIRST_DATE, AQUA_START - dt.timedelta(days=1)),
    ("MODIS_TA", AQUA_START, SNPP_START - dt.timedelta(days=1)),
    ("VIIRS_SNPP", SNPP_START, SNPP_END),
    ("VIIRS_N20", SNPP_END + dt.timedelta(days=1), None),
]


def month_start(d: dt.date) -> dt.date:
    return d.replace(day=1)


def load_outages(path: Path) -> frozenset[dt.date]:
    """Outage months (first day of month) from data/outage_months.csv; empty if the file is missing."""
    if not path.exists():
        return frozenset()
    with open(path, encoding="utf-8") as f:
        return frozenset(dt.date.fromisoformat(r["month"] + "-01") for r in csv.DictReader(f))


def lead_source(d: dt.date, outages: frozenset[dt.date] = frozenset()) -> str:
    """Lead source id for a date (any day of the month works for monthly values)."""
    if d < FIRST_DATE:
        raise ValueError(f"no data before {FIRST_DATE}")
    if d < AQUA_START:
        return "MODIS_T"
    if d < SNPP_START:
        return "MODIS_TA"
    if d > SNPP_END or month_start(d) in outages:
        return "VIIRS_N20"
    return "VIIRS_SNPP"


def value_sql(metric: str, g: str, w: str, source: str = "source") -> str:
    """Harmonized value of a grid row `g` with coefficients row `w`, given the lead-source column `source`.

    count: Terra-only / Terra+Aqua / NOAA-20 detections x coefficient, S-NPP as is; frp: the same with FRP columns.
    """
    p, k = ("n", "count") if metric == "count" else ("f", "frp")
    return (
        f"CASE {source} WHEN 'MODIS_T' THEN {g}.{p}_t * {w}.w_{k}_t "
        f"WHEN 'MODIS_TA' THEN ({g}.{p}_t + {g}.{p}_a) * {w}.w_{k}_ta "
        f"WHEN 'VIIRS_N20' THEN {g}.{p}_n20 * {w}.w_{k}_n20 "
        f"ELSE {g}.{p}_snpp END"
    )


def lead_sql(col: str, outages: frozenset[dt.date] = frozenset()) -> str:
    """The same rule as a SQL CASE expression over a DATE column (for DuckDB)."""
    out = ", ".join(f"DATE '{m.isoformat()}'" for m in sorted(outages)) or "NULL"
    return (
        f"CASE WHEN {col} < DATE '{AQUA_START}' THEN 'MODIS_T' "
        f"WHEN {col} < DATE '{SNPP_START}' THEN 'MODIS_TA' "
        f"WHEN {col} > DATE '{SNPP_END}' OR date_trunc('month', {col})::DATE IN ({out}) THEN 'VIIRS_N20' "
        f"ELSE 'VIIRS_SNPP' END"
    )
