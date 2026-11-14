"""POST /calendar: monthly grid "year x month", baselines, yearly totals and summary (CalendarResponse)."""

import calendar as cal
import datetime as dt

from . import geometry, lead, series, stats
from .data import COUNT_UNIT, FRP_UNIT, Data
from .errors import ApiError
from .schemas import AreaQuery


def month_end(m: dt.date) -> dt.date:
    return m.replace(day=cal.monthrange(m.year, m.month)[1])


def complete_years(data: Data) -> tuple[int, int]:
    """First and last years fully covered by data."""
    first = data.first_date.year + (0 if data.first_date == dt.date(data.first_date.year, 1, 1) else 1)
    last = data.last_date.year - (0 if data.last_date == dt.date(data.last_date.year, 12, 31) else 1)
    return first, last


def resolve_period(data: Data, q: AreaQuery) -> tuple[dt.date, dt.date, tuple[int, int]]:
    """First month, last day of the period and the baseline years, validated against the data."""
    start_year = q.start_year if q.start_year is not None else data.first_date.year
    end_year = q.end_year if q.end_year is not None else data.last_date.year
    if start_year > data.last_date.year:
        raise ApiError("NO_DATA", f"Данные есть только до {data.last_date}.")
    if start_year > end_year:
        raise ApiError("INVALID_REQUEST", "start_year больше end_year.")
    first_full, last_full = complete_years(data)
    if q.baseline is not None:
        base = (q.baseline.start_year, q.baseline.end_year)
        if base[0] > base[1]:
            raise ApiError("INVALID_REQUEST", "В базовом периоде start_year больше end_year.")
        if base[0] < first_full or base[1] > last_full:
            raise ApiError("INVALID_REQUEST", f"Базовый период должен лежать в полных годах {first_full}–{last_full}.")
    else:
        base = (first_full, last_full)
    first = max(dt.date(start_year, 1, 1), data.first_date.replace(day=1))
    last = min(dt.date(end_year, 12, 31), data.last_date)
    return first, last, base


def build(data: Data, q: AreaQuery) -> dict:
    area = geometry.parse(q.geometry, data.settings.max_area_km2)
    first, last, base = resolve_period(data, q)
    query_first = min(first, dt.date(base[0], 1, 1))
    query_last = max(last, dt.date(base[1], 12, 31))
    df = series.query(data, area, q.metric, query_first, query_last)
    by_month = {r.t: r for r in df.itertuples(index=False)}

    def value_of(m: dt.date) -> float:
        r = by_month.get(m)
        return float(r.value) if r is not None else 0.0

    # climatology of each calendar month over the baseline years
    samples = {mo: [value_of(dt.date(y, mo, 1)) for y in range(base[0], base[1] + 1)] for mo in range(1, 13)}
    monthly_baseline = [{"month": mo, **stats.baseline_stats(samples[mo])} for mo in range(1, 13)]

    partial_month = data.last_date.replace(day=1) if data.last_date != month_end(data.last_date) else None
    months = []
    for m in series.month_range(first, last):
        v = value_of(m)
        source = lead.lead_source(m, data.outages)
        b = monthly_baseline[m.month - 1]
        partial = m == partial_month
        low, high = data.uncertainty.interval(source, q.metric, v)
        vr = stats.r1(v)
        item = {
            "year": m.year,
            "month": m.month,
            "value": vr,
            "low": min(stats.r1(low), vr),
            "high": max(stats.r1(high), vr),
            "median": b["median"] if b["n_years"] else None,
            "anomaly_pct": None if partial else stats.anomaly_pct(v, b["median"] if b["n_years"] else None),
            "percentile": None if partial else stats.percentile_of(samples[m.month], v),
            "category": None if partial else stats.category(v, b, base[0] <= m.year <= base[1]),
            "source": source,
            "preliminary": month_end(m) > data.last_standard_date,
            "partial": partial,
            "sensor_gap": m in data.outages,
        }
        if q.series == "raw":
            r = by_month.get(m)
            avail = series.raw_available(m)
            item["raw"] = {
                k: (stats.r1(getattr(r, k)) if r is not None else 0.0) if avail[k] else None
                for k in ("modis", "viirs_snpp", "viirs_n20")
            }
        months.append(item)

    full_first, full_last = complete_years(data)
    yearly = []
    for year in range(first.year, last.year + 1):
        total = sum(mm["value"] for mm in months if mm["year"] == year)
        yearly.append({"year": year, "total": stats.r1(total), "complete": full_first <= year <= full_last})
    complete = [y for y in yearly if y["complete"]]
    trend_pct, trend_line = stats.trend([y["year"] for y in complete], [y["total"] for y in complete])
    peak = max(complete, key=lambda y: y["total"], default=None)
    medians = [b["median"] for b in monthly_baseline]

    warnings = []
    if area.cells < data.settings.min_cells_warning:
        warnings.append(
            {
                "code": "AREA_SMALL",
                "message": f"В область попало ячеек сетки: {area.cells}. Для такой маленькой области ряд шумный.",
            }
        )
    if any(mm["preliminary"] for mm in months):
        warnings.append(
            {
                "code": "PRELIMINARY_DATA",
                "message": f"Месяцы после {data.last_standard_date} посчитаны по оперативным данным и будут уточнены.",
            }
        )
    gaps = [f"{mm['year']}-{mm['month']:02d}" for mm in months if mm["sensor_gap"]]
    if gaps:
        warnings.append(
            {
                "code": "SENSOR_GAP",
                "message": "Перерывы в работе Suomi NPP, значения взяты с NOAA-20: " + ", ".join(gaps) + ".",
            }
        )

    return {
        "area_km2": round(area.area_km2),
        "cells": area.cells,
        "unit": COUNT_UNIT if q.metric == "count" else FRP_UNIT,
        "metric": q.metric,
        "series": q.series,
        "baseline": {"start_year": base[0], "end_year": base[1]},
        "data_through": last.isoformat(),
        "months": months,
        "monthly_baseline": monthly_baseline,
        "yearly": yearly,
        "summary": {
            "peak_year": peak["year"] if peak and peak["total"] > 0 else None,
            "peak_month": (medians.index(max(medians)) + 1) if max(medians) > 0 else None,
            "total": stats.r1(sum(mm["value"] for mm in months)),
            "trend_pct_per_decade": trend_pct,
            "trend_line": trend_line,
        },
        "warnings": warnings,
    }


CSV_COLUMNS = [
    "year", "month", "value", "low", "high", "median", "anomaly_pct",
    "percentile", "category", "source", "preliminary", "partial",
]  # fmt: skip


def to_csv(payload: dict) -> str:
    def fmt(v):
        if v is None:
            return ""
        if isinstance(v, bool):
            return str(v).lower()
        return str(v)

    lines = [",".join(CSV_COLUMNS)]
    lines += [",".join(fmt(m[c]) for c in CSV_COLUMNS) for m in payload["months"]]
    return "\n".join(lines) + "\n"
