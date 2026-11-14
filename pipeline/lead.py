"""Which sensor leads the harmonized series on a given date. Single source of truth for pipeline and backend.

Periods (docs/methodology.md, section 5):
  MODIS_T     2000-11-01 .. 2002-07-31   MODIS Terra only (Aqua data starts 2002-07-04)
  MODIS_TA    2002-08-01 .. 2012-01-31   MODIS Terra + Aqua
  VIIRS_SNPP  2012-02-01 .. SNPP_END     reference sensor, no conversion
  VIIRS_N20   SNPP_END+1 .. today        NOAA-20 x coefficient
NOAA-20 also replaces S-NPP for whole S-NPP outage months (data/outage_months.csv, found by harmonize.py).

Sensor gap days (data/gap_days.csv, found by harmonize.py) refine the rule day by day. On a day when the regular lead
sensor did not report:
  * Suomi NPP gap -> NOAA-20 x coefficient (from 2018-04), or MODIS Terra + Aqua x coefficient before NOAA-20;
  * Aqua gap in the Terra + Aqua period -> Terra x "Terra only" coefficient;
  * Terra gap (and NOAA-20 gap after Suomi NPP) -> no substitute; the day stays as it is and its month is flagged.
A month gets the `sensor_gap` flag when its lead sensor had an outage month or at least one gap day (gap_months).
"""

import csv
import datetime as dt
from collections.abc import Mapping
from pathlib import Path

FIRST_DATE = dt.date(2000, 11, 1)
AQUA_START = dt.date(2002, 8, 1)
SNPP_START = dt.date(2012, 2, 1)
SNPP_END = dt.date(2026, 10, 31)  # S-NPP stops reporting in early November 2026 (FIRMS data availability)
N20_FIRST = dt.date(2018, 4, 1)  # first month of NOAA-20 standard data

GAP_SENSORS = ("terra", "aqua", "snpp", "n20")
# sensors whose detections a lead source uses: a gap in any of them is a gap of that source
SOURCE_SENSORS = {"MODIS_T": ("terra",), "MODIS_TA": ("terra", "aqua"), "VIIRS_SNPP": ("snpp",), "VIIRS_N20": ("n20",)}

GapDays = Mapping[str, frozenset[dt.date]]  # sensor (GAP_SENSORS) -> days without (or with almost no) data

LABELS = {
    "MODIS_T": "MODIS Terra × coefficient",
    "MODIS_TA": "MODIS Terra + Aqua × coefficient",
    "VIIRS_SNPP": "VIIRS Suomi NPP (reference)",
    "VIIRS_N20": "VIIRS NOAA-20 × coefficient",
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


def load_gap_days(path: Path) -> dict[str, frozenset[dt.date]]:
    """Gap days per sensor from data/gap_days.csv (date,sensor,ratio); empty if the file is missing."""
    if not path.exists():
        return {}
    out: dict[str, set[dt.date]] = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.setdefault(r["sensor"], set()).add(dt.date.fromisoformat(r["date"]))
    return {s: frozenset(v) for s, v in out.items()}


def _month_source(d: dt.date, outages: frozenset[dt.date]) -> str:
    if d < FIRST_DATE:
        raise ValueError(f"no data before {FIRST_DATE}")
    if d < AQUA_START:
        return "MODIS_T"
    if d < SNPP_START:
        return "MODIS_TA"
    if d > SNPP_END or month_start(d) in outages:
        return "VIIRS_N20"
    return "VIIRS_SNPP"


def lead_source(d: dt.date, outages: frozenset[dt.date] = frozenset(), gaps: GapDays | None = None) -> str:
    """Lead source id for a date.

    Without `gaps` this is the month rule (any day of the month gives the month's source). With `gaps` it is the
    day rule: the source actually used on that day after replacing a lead sensor that has a gap day.
    """
    base = _month_source(d, outages)
    if not gaps:
        return base

    def gap(sensor: str) -> bool:
        return d in gaps.get(sensor, ())

    if base == "MODIS_TA" and gap("aqua") and not gap("terra"):
        return "MODIS_T"
    if base == "VIIRS_SNPP" and gap("snpp"):
        if d >= N20_FIRST and not gap("n20"):
            return "VIIRS_N20"
        if d < N20_FIRST and not gap("terra") and not gap("aqua"):
            return "MODIS_TA"
    return base


def lead_gap(d: dt.date, outages: frozenset[dt.date], gaps: GapDays) -> bool:
    """The regular lead sensor of day d (month rule) had a gap that day, whether or not it was replaced."""
    return any(d in gaps.get(s, ()) for s in SOURCE_SENSORS[_month_source(d, outages)])


def _gap_days(gaps: GapDays) -> set[dt.date]:
    return {d for s in GAP_SENSORS for d in gaps.get(s, ()) if d >= FIRST_DATE}


def gap_months(outages: frozenset[dt.date], gaps: GapDays) -> frozenset[dt.date]:
    """Months flagged `sensor_gap`: S-NPP outage months and months with a gap day of their lead sensor."""
    return frozenset(outages) | {month_start(d) for d in _gap_days(gaps) if lead_gap(d, outages, gaps)}


def substitutions(outages: frozenset[dt.date], gaps: GapDays) -> dict[dt.date, str]:
    """Days whose source differs from the month rule -> the source used on that day."""
    out = {}
    for d in sorted(_gap_days(gaps)):
        src = lead_source(d, outages, gaps)
        if src != _month_source(d, outages):
            out[d] = src
    return out


def substituted_months(outages: frozenset[dt.date], gaps: GapDays) -> frozenset[dt.date]:
    """Months whose value must be summed from daily rows, because some of their days use another source."""
    return frozenset(month_start(d) for d in substitutions(outages, gaps))


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


def lead_sql(col: str, outages: frozenset[dt.date] = frozenset(), gaps: GapDays | None = None) -> str:
    """The same rule as a SQL CASE expression over a DATE column (for DuckDB).

    With `gaps` the column must hold days (grid_daily.date, points acq_date): a monthly row is dated the 1st of its
    month, and a gap on the 1st would switch the whole month. Monthly sums of substituted months are built from daily
    rows instead (substituted_months).
    """
    out = ", ".join(f"DATE '{m.isoformat()}'" for m in sorted(outages)) or "NULL"
    base = (
        f"CASE WHEN {col} < DATE '{AQUA_START}' THEN 'MODIS_T' "
        f"WHEN {col} < DATE '{SNPP_START}' THEN 'MODIS_TA' "
        f"WHEN {col} > DATE '{SNPP_END}' OR date_trunc('month', {col})::DATE IN ({out}) THEN 'VIIRS_N20' "
        f"ELSE 'VIIRS_SNPP' END"
    )
    subs = substitutions(outages, gaps) if gaps else {}
    if not subs:
        return base
    by_source: dict[str, list[str]] = {}
    for d, src in subs.items():
        by_source.setdefault(src, []).append(f"DATE '{d.isoformat()}'")
    whens = " ".join(f"WHEN {col} IN ({', '.join(days)}) THEN '{src}'" for src, days in sorted(by_source.items()))
    return f"CASE {whens} ELSE {base} END"
