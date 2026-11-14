"""POST /current (this month so far vs the same days of past years) and POST /daily (one year, day by day)."""

import datetime as dt

import numpy as np

from . import geometry, lead, series, stats
from .calendar_service import complete_years
from .data import COUNT_UNIT, FRP_UNIT, Data
from .errors import ApiError
from .schemas import AreaQuery, DailyQuery


def _warnings(data: Data, area, preliminary: bool, gap_months: list[dt.date]) -> list[dict]:
    out = []
    if area.cells < data.settings.min_cells_warning:
        out.append(
            {
                "code": "AREA_SMALL",
                "message": geometry.small_area_message(area),
            }
        )
    if preliminary:
        out.append({"code": "PRELIMINARY_DATA", "message": "The current month is computed from near-real-time data."})
    if gap_months:
        months = ", ".join(f"{m:%Y-%m}" for m in gap_months)
        out.append(
            {
                "code": "SENSOR_GAP",
                "message": f"The lead satellite had outages in {months}; days without its data are taken from "
                "another satellite where one exists, otherwise the value may be understated.",
            }
        )
    return out


def current(data: Data, q: AreaQuery) -> dict:
    area = geometry.parse(q.geometry, data.settings.max_area_km2)
    as_of = data.last_date
    year, month, days = as_of.year, as_of.month, as_of.day
    first_full, last_full = complete_years(data)
    if q.baseline is not None:
        base = (q.baseline.start_year, q.baseline.end_year)
        if base[0] > base[1] or base[0] < first_full or base[1] > last_full:
            raise ApiError(
                "INVALID_REQUEST", f"The baseline period must lie within the full years {first_full}–{last_full}."
            )
    else:
        base = (first_full, last_full)
    # only this calendar month, days 1..days, in the baseline years and the current year
    first = dt.date(min(base[0], year), 1, 1)
    df = series.query(
        data,
        area,
        q.metric,
        first,
        as_of,
        daily=True,
        where=f"month(j.date) = {month} AND day(j.date) <= {days}",
    )
    by_day = {r.t: float(r.value) for r in df.itertuples(index=False)}

    def cumulative(y: int) -> np.ndarray:
        vals = [by_day.get(dt.date(y, month, d), 0.0) if _valid(y, month, d) else 0.0 for d in range(1, days + 1)]
        return np.cumsum(vals)

    now = cumulative(year)
    # the current month never counts as its own baseline
    past = {y: cumulative(y) for y in range(base[0], base[1] + 1) if y != year}
    totals = [float(c[-1]) for c in past.values()]
    base_stats = stats.baseline_stats(totals)
    value = float(now[-1])
    pct = stats.percentile_of(totals, value)
    median_by_day = np.median(np.vstack(list(past.values())), axis=0) if past else np.zeros(days)
    month_start = as_of.replace(day=1)
    return {
        "as_of": as_of.isoformat(),
        "year": year,
        "month": month,
        "days_elapsed": days,
        "value": stats.r1(value),
        "baseline_same_days": {k: base_stats[k] for k in ("median", "p25", "p75", "p90", "max", "n_years")},
        "anomaly_pct": stats.anomaly_pct(value, base_stats["median"] if base_stats["n_years"] else None),
        "percentile": pct,
        "category": stats.category(pct, value, base_stats, in_baseline=False),
        "source": lead.lead_source(as_of, data.outages, data.gap_days),
        "preliminary": as_of > data.last_standard_date,
        "cumulative": [
            {"day": d + 1, "value": stats.r1(now[d]), "median": stats.r1(median_by_day[d])} for d in range(days)
        ],
        "warnings": _warnings(
            data, area, as_of > data.last_standard_date, [month_start] if month_start in data.gap_months else []
        ),
    }


def _valid(y: int, m: int, d: int) -> bool:
    try:
        dt.date(y, m, d)
        return True
    except ValueError:  # 29 February in a non-leap year
        return False


def daily(data: Data, q: DailyQuery) -> dict:
    area = geometry.parse(q.geometry, data.settings.max_area_km2)
    if q.year > data.last_date.year or q.year < lead.FIRST_DATE.year:
        raise ApiError("NO_DATA", f"Daily data is available for {lead.FIRST_DATE}–{data.last_date}.")
    first = max(dt.date(q.year, 1, 1), lead.FIRST_DATE)
    last = min(dt.date(q.year, 12, 31), data.last_date)
    df = series.query(data, area, q.metric, first, last, daily=True)
    by_day = {r.t: float(r.value) for r in df.itertuples(index=False)}
    days, d = [], first
    while d <= last:
        days.append(
            {"date": d.isoformat(), "value": stats.r1(by_day.get(d, 0.0)), "preliminary": d > data.last_standard_date}
        )
        d += dt.timedelta(days=1)
    return {"year": q.year, "unit": COUNT_UNIT if q.metric == "count" else FRP_UNIT, "metric": q.metric, "days": days}
