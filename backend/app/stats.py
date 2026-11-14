"""Climatology helpers: quantiles, percentile rank, category, trend. Pure functions, no I/O."""

import math

import numpy as np

CATEGORIES = ("below_normal", "normal", "above_normal", "high", "record")


def r1(x: float | None) -> float | None:
    return None if x is None else round(float(x), 1)


def baseline_stats(sample: list[float]) -> dict:
    """median, p10, p25, p75, p90, max, n_years of one calendar month over the baseline years."""
    if not sample:
        return {"median": 0.0, "p10": 0.0, "p25": 0.0, "p75": 0.0, "p90": 0.0, "max": 0.0, "n_years": 0}
    a = np.asarray(sample, dtype=float)
    q = np.quantile(a, [0.5, 0.1, 0.25, 0.75, 0.9])  # linear interpolation
    return {
        "median": r1(q[0]),
        "p10": r1(q[1]),
        "p25": r1(q[2]),
        "p75": r1(q[3]),
        "p90": r1(q[4]),
        "max": r1(a.max()),
        "n_years": int(a.size),
    }


def percentile_of(sample: list[float], value: float) -> float | None:
    """Mid-rank percentile of the value among the baseline years, 0-100 (contract: MonthValue.percentile).

    Years below the value count fully, years equal to it count half, so ties (typically many fire-free years)
    put the value in the middle of the tie instead of at its top: a month without fires among years without
    fires is the 50th percentile, not the 100th. Values are compared after rounding to 0.1, as published.
    """
    if not sample:
        return None
    v = r1(value)
    below = sum(1 for s in sample if r1(s) < v)
    equal = sum(1 for s in sample if r1(s) == v)
    return r1(100 * (below + 0.5 * equal) / len(sample))


def category(percentile: float | None, value: float, base: dict, in_baseline: bool) -> str | None:
    """Contract Category from the published percentile, so the two fields always agree.

    below 25 -> below_normal, 25-75 -> normal, above 75 up to 90 -> above_normal, above 90 -> high;
    record = a year outside the baseline whose rounded value is above the baseline maximum.
    """
    if percentile is None or base["n_years"] == 0:
        return None
    if not in_baseline and r1(value) > base["max"] and value > 0:
        return "record"
    if percentile < 25:
        return "below_normal"
    if percentile <= 75:
        return "normal"
    if percentile <= 90:
        return "above_normal"
    return "high"


def anomaly_pct(value: float, median: float | None) -> float | None:
    if median is None or median == 0:
        return None
    return r1((value - median) / median * 100)


def trend(years: list[int], totals: list[float], min_years: int = 10) -> tuple[float | None, dict | None]:
    """OLS of yearly totals on year: (% per decade of the mean, trend_line with both ends) or (None, None)."""
    if len(years) < min_years:
        return None, None
    x, y = np.asarray(years, dtype=float), np.asarray(totals, dtype=float)
    mean_y = y.mean()
    if mean_y == 0 or not math.isfinite(mean_y):
        return None, None
    slope, intercept = np.polyfit(x, y, 1)
    line = {
        "start_year": int(x[0]),
        "start_value": r1(intercept + slope * x[0]),
        "end_year": int(x[-1]),
        "end_value": r1(intercept + slope * x[-1]),
    }
    return r1(slope * 10 / mean_y * 100), line
