"""Generates example API responses in contract/examples/.

The data is SYNTHETIC: plausible numbers for mock-ups and frontend mocks,
not the result of processing FIRMS data. The generator is deterministic (fixed seed),
so re-running it produces the same files.

Run from the repository root:
    python contract/tools/generate_examples.py
"""

from __future__ import annotations

import calendar
import csv
import io
import json
import math
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
SEED = 20261114

UNIT = "viirs_snpp_equivalent_detections"
DATA_VERSION = "synthetic-example-0.1"
FIRST_DATE = date(2000, 11, 1)
LAST_DATE = date(2026, 11, 13)          # last day with data in the examples
LAST_STANDARD_DATE = date(2026, 6, 30)  # later dates are near-real-time (preliminary) data
BASELINE = (2001, 2025)

# Suomi NPP outage months: as in the pipeline, NOAA-20 drives the series in them and the month is flagged sensor_gap.
SNPP_OUTAGES = {(2022, 7), (2022, 8), (2024, 7), (2024, 11)}

# Area from the example request: steppe zone, two burning waves - in spring and in late summer.
AREA = {"west": 61.0, "south": 51.0, "east": 71.0, "north": 55.0}
SEASON = [5, 8, 60, 520, 780, 210, 260, 640, 720, 240, 40, 6]  # typical month, VIIRS equivalent
K_MODIS = [3.4, 3.4, 4.6, 5.2, 4.8, 4.0, 3.8, 3.9, 4.1, 4.4, 3.6, 3.4]  # VIIRS detections per MODIS detection


def bbox_polygon(west: float, south: float, east: float, north: float) -> dict:
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}


def source_for(year: int, month: int) -> str:
    ym = (year, month)
    if ym <= (2002, 7):
        return "MODIS_T"
    if ym <= (2012, 1):
        return "MODIS_TA"
    if ym <= (2026, 10) and ym not in SNPP_OUTAGES:
        return "VIIRS_SNPP"
    return "VIIRS_N20"


def interval(source: str, value: float) -> tuple[float, float]:
    spread = {"MODIS_T": (0.74, 1.30), "MODIS_TA": (0.82, 1.21), "VIIRS_SNPP": (1.0, 1.0), "VIIRS_N20": (0.95, 1.05)}
    low, high = spread[source]
    return round(value * low, 1), round(value * high, 1)


def quantile(sorted_values: list[float], q: float) -> float:
    """Quantile with linear interpolation (like numpy.quantile by default)."""
    if not sorted_values:
        return 0.0
    pos = (len(sorted_values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def percentile_of(sorted_values: list[float], value: float) -> float:
    below = sum(1 for v in sorted_values if v <= value)
    return round(100 * below / len(sorted_values), 0)


def category_for(value: float, base: dict, in_baseline: bool) -> str:
    if not in_baseline and value > base["max"]:
        return "record"
    if value < base["p25"]:
        return "below_normal"
    if value <= base["p75"]:
        return "normal"
    if value <= base["p90"]:
        return "above_normal"
    return "high"


def month_iter():
    year, month = FIRST_DATE.year, FIRST_DATE.month
    while (year, month) <= (LAST_DATE.year, LAST_DATE.month):
        yield year, month
        month += 1
        if month == 13:
            year, month = year + 1, 1


def build_series(rng: random.Random) -> dict[tuple[int, int], float]:
    """Monthly values of the unified series: seasonality x "year character" x noise."""
    year_factor = {y: math.exp(rng.gauss(0.0, 0.42)) for y in range(2000, 2027)}
    year_factor[2010] *= 1.9  # one clearly heavy year, so the mock-up shows an extreme
    values = {}
    for year, month in month_iter():
        value = SEASON[month - 1] * year_factor[year] * math.exp(rng.gauss(0.0, 0.35))
        if (year, month) == (LAST_DATE.year, LAST_DATE.month):
            value *= LAST_DATE.day / calendar.monthrange(year, month)[1]  # incomplete current month
        values[(year, month)] = round(value, 1)
    return values


def build_baseline(values: dict) -> list[dict]:
    out = []
    for month in range(1, 13):
        sample = sorted(values[(y, month)] for y in range(BASELINE[0], BASELINE[1] + 1))
        out.append(
            {
                "month": month,
                "median": round(quantile(sample, 0.5), 1),
                "p10": round(quantile(sample, 0.10), 1),
                "p25": round(quantile(sample, 0.25), 1),
                "p75": round(quantile(sample, 0.75), 1),
                "p90": round(quantile(sample, 0.90), 1),
                "max": sample[-1],
                "n_years": len(sample),
            }
        )
    return out


def raw_values(rng: random.Random, year: int, month: int, value: float) -> dict:
    ym = (year, month)
    modis = round(value / K_MODIS[month - 1] * math.exp(rng.gauss(0.0, 0.08)), 1)
    outage = 0.6 if ym in SNPP_OUTAGES else 1.0  # in an outage month Suomi NPP sees noticeably fewer detections
    snpp = round(value * outage * math.exp(rng.gauss(0.0, 0.03)), 1) if (2012, 1) <= ym <= (2026, 10) else None
    n20 = round(value * 1.03 * math.exp(rng.gauss(0.0, 0.03)), 1) if ym >= (2018, 4) else None
    return {"modis": modis, "viirs_snpp": snpp, "viirs_n20": n20}


def build_calendar(values: dict, baseline: list[dict], series: str, rng: random.Random) -> dict:
    months = []
    for (year, month), value in values.items():
        base = baseline[month - 1]
        sample = sorted(values[(y, month)] for y in range(BASELINE[0], BASELINE[1] + 1))
        source = source_for(year, month)
        low, high = interval(source, value)
        partial = (year, month) == (LAST_DATE.year, LAST_DATE.month)
        item = {
            "year": year,
            "month": month,
            "value": value,
            "low": low,
            "high": high,
            "median": base["median"],
            "anomaly_pct": round((value - base["median"]) / base["median"] * 100, 1) if base["median"] else None,
            "percentile": None if partial else percentile_of(sample, value),
            "category": None if partial else category_for(value, base, BASELINE[0] <= year <= BASELINE[1]),
            "source": source,
            "preliminary": date(year, month, 1) > LAST_STANDARD_DATE,
            "partial": partial,
            "sensor_gap": (year, month) in SNPP_OUTAGES,
        }
        if partial:
            item["anomaly_pct"] = None  # an incomplete month cannot be compared with a full-month median
        if series == "raw":
            item["raw"] = raw_values(rng, year, month, value)
        months.append(item)

    yearly = []
    for year in range(FIRST_DATE.year, LAST_DATE.year + 1):
        total = round(sum(v for (y, _), v in values.items() if y == year), 1)
        yearly.append({"year": year, "total": total, "complete": BASELINE[0] <= year <= BASELINE[1]})

    complete = [y for y in yearly if y["complete"]]
    xs = [y["year"] for y in complete]
    ys = [y["total"] for y in complete]
    mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / sum((x - mean_x) ** 2 for x in xs)
    trend_line = {
        "start_year": xs[0],
        "start_value": round(mean_y + slope * (xs[0] - mean_x), 1),
        "end_year": xs[-1],
        "end_value": round(mean_y + slope * (xs[-1] - mean_x), 1),
    }

    lat_mid = math.radians((AREA["south"] + AREA["north"]) / 2)
    width_km = (AREA["east"] - AREA["west"]) * 111.32 * math.cos(lat_mid)
    height_km = (AREA["north"] - AREA["south"]) * 110.57
    cells = round((AREA["east"] - AREA["west"]) / 0.1) * round((AREA["north"] - AREA["south"]) / 0.1)

    return {
        "area_km2": round(width_km * height_km),
        "cells": cells,
        "unit": UNIT,
        "metric": "count",
        "series": series,
        "baseline": {"start_year": BASELINE[0], "end_year": BASELINE[1]},
        "data_through": LAST_DATE.isoformat(),
        "months": months,
        "monthly_baseline": baseline,
        "yearly": yearly,
        "summary": {
            "peak_year": max(complete, key=lambda y: y["total"])["year"],
            "peak_month": max(baseline, key=lambda b: b["median"])["month"],
            "total": round(sum(values.values()), 1),
            "trend_pct_per_decade": round(slope * 10 / mean_y * 100, 1),
            "trend_line": trend_line,
        },
        "warnings": [
            {
                "code": "PRELIMINARY_DATA",
                "message": "Months after 2026-06-30 are computed from near-real-time data and will be refined.",
            },
            {
                "code": "SENSOR_GAP",
                "message": "In 4 months Suomi NPP had outages: values are computed from NOAA-20.",
            },
        ],
    }


def build_current(rng: random.Random) -> dict:
    year, month, days = LAST_DATE.year, LAST_DATE.month, LAST_DATE.day
    daily_median = SEASON[month - 1] / calendar.monthrange(year, month)[1]
    cumulative, value, median = [], 0.0, 0.0
    for day in range(1, days + 1):
        value += max(0.0, daily_median * 1.6 * math.exp(rng.gauss(0.0, 0.6)))
        median += daily_median
        cumulative.append({"day": day, "value": round(value, 1), "median": round(median, 1)})
    value, median = cumulative[-1]["value"], cumulative[-1]["median"]
    base = {
        "median": median,
        "p25": round(median * 0.55, 1),
        "p75": round(median * 1.45, 1),
        "p90": round(median * 2.1, 1),
        "max": round(median * 3.4, 1),
        "n_years": BASELINE[1] - BASELINE[0] + 1,
    }
    return {
        "as_of": LAST_DATE.isoformat(),
        "year": year,
        "month": month,
        "days_elapsed": days,
        "value": value,
        "baseline_same_days": base,
        "anomaly_pct": round((value - median) / median * 100, 1),
        "percentile": 84,
        "category": category_for(value, base, in_baseline=False),
        "source": source_for(year, month),
        "preliminary": True,
        "cumulative": cumulative,
        "warnings": [
            {"code": "PRELIMINARY_DATA", "message": "The current month is computed from near-real-time data."}
        ],
    }


def build_points(rng: random.Random, year: int, month: int, n: int) -> dict:
    features = []
    for _ in range(n):
        day = rng.randint(1, calendar.monthrange(year, month)[1])
        night = rng.random() < 0.25
        hour = rng.choice([20, 21]) if night else rng.choice([7, 8])  # UTC, around 13:30 and 01:30 local time
        moment = datetime(year, month, day, hour, rng.randint(0, 59), tzinfo=timezone.utc)
        satellite = rng.choice(["T", "A"])
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        round(rng.uniform(AREA["west"], AREA["east"]), 4),
                        round(rng.uniform(AREA["south"], AREA["north"]), 4),
                    ],
                },
                "properties": {
                    "acq_datetime": moment.isoformat().replace("+00:00", "Z"),
                    "sensor": "MODIS",
                    "satellite": satellite,
                    "conf_class": rng.choice(["nominal", "nominal", "high"]),
                    "frp": round(math.exp(rng.gauss(3.0, 0.9)), 1),
                    "daynight": "N" if night else "D",
                    "quality": "SP",
                    "harmonized_weight": K_MODIS[month - 1],
                },
            }
        )
    features.sort(key=lambda f: f["properties"]["acq_datetime"])
    return {"type": "FeatureCollection", "features": features, "total": n, "truncated": False}


def build_daily(rng: random.Random, values: dict, year: int) -> dict:
    days = []
    for month in range(1, 13):
        n_days = calendar.monthrange(year, month)[1]
        weights = [rng.random() ** 3 for _ in range(n_days)]  # burning comes in short flare-ups
        total = sum(weights)
        for day in range(1, n_days + 1):
            days.append(
                {
                    "date": date(year, month, day).isoformat(),
                    "value": round(values[(year, month)] * weights[day - 1] / total, 1),
                    "preliminary": False,
                }
            )
    return {"year": year, "unit": UNIT, "metric": "count", "days": days}


def build_validation(rng: random.Random) -> dict:
    regions = []
    presets = [("kz-steppe", "Northern Kazakhstan", 1.0), ("amazon-south", "Southern Amazon", 6.5), ("california-north", "Northern California", 0.35)]
    for region_id, name, scale in presets:
        series = []
        for year in range(2021, 2026):
            year_factor = math.exp(rng.gauss(0.0, 0.4))
            for month in range(1, 13):
                viirs = SEASON[month - 1] * scale * year_factor * math.exp(rng.gauss(0.0, 0.3))
                modis = viirs / K_MODIS[month - 1] * math.exp(rng.gauss(0.0, 0.12))
                harmonized = modis * K_MODIS[month - 1] * 1.04  # a small bias, as on the held-out years
                series.append(
                    {
                        "year": year,
                        "month": month,
                        "modis_raw": round(modis, 1),
                        "viirs_raw": round(viirs, 1),
                        "harmonized": round(harmonized, 1),
                    }
                )
        actual = [p["viirs_raw"] for p in series]
        predicted = [p["harmonized"] for p in series]
        mean_a, mean_p = sum(actual) / len(actual), sum(predicted) / len(predicted)
        cov = sum((a - mean_a) * (p - mean_p) for a, p in zip(actual, predicted))
        var = math.sqrt(sum((a - mean_a) ** 2 for a in actual) * sum((p - mean_p) ** 2 for p in predicted))
        errors = sorted(abs(p - a) / a * 100 for a, p in zip(actual, predicted) if a > 0)
        regions.append(
            {
                "id": region_id,
                "name": name,
                "metrics": {
                    "pearson_r": round(cov / var, 3),
                    "bias_pct": round((sum(predicted) - sum(actual)) / sum(actual) * 100, 1),
                    "mape_pct": round(quantile(errors, 0.5), 1),
                    "n_months": len(series),
                },
                "series": series,
            }
        )
    return {
        "calibration_period": {"start_year": 2012, "end_year": 2020},
        "test_period": {"start_year": 2021, "end_year": 2025},
        "regions": regions,
        "seams": [
            {
                "id": "modis_to_snpp_2012",
                "label": "MODIS → Suomi NPP transition, 2009–2011 vs 2012–2014",
                "ratio_harmonized": 1.04,
                "ratio_naive": 4.31,
            },
            {
                "id": "snpp_to_n20_2026",
                "label": "Suomi NPP → NOAA-20 transition, checked on 2024–2025",
                "ratio_harmonized": 1.01,
                "ratio_naive": 1.03,
            },
        ],
        "limitations": [
            "Fires that MODIS missed entirely are not recovered by the coefficient.",
            "For areas smaller than a few grid cells the series is noisy.",
            "Satellite outages look like periods of low activity.",
        ],
    }


def build_meta() -> dict:
    return {
        "data_version": DATA_VERSION,
        "unit": UNIT,
        "grid_deg": 0.1,
        "first_date": FIRST_DATE.isoformat(),
        "last_date": LAST_DATE.isoformat(),
        "last_standard_date": LAST_STANDARD_DATE.isoformat(),
        "sources": [
            {"id": "MODIS_T", "label": "MODIS Terra × coefficient", "start": "2000-11-01", "end": "2002-07-31"},
            {"id": "MODIS_TA", "label": "MODIS Terra + Aqua × coefficient", "start": "2002-08-01", "end": "2012-01-31"},
            {"id": "VIIRS_SNPP", "label": "VIIRS Suomi NPP (reference)", "start": "2012-02-01", "end": "2026-10-31"},
            {"id": "VIIRS_N20", "label": "VIIRS NOAA-20 × coefficient", "start": "2026-11-01", "end": None},
        ],
        "limits": {"max_area_km2": 3000000, "min_cells_warning": 9, "max_export_rows": 500000, "max_points": 20000},
        "coverage": {"global": False, "regions": ["Kazakhstan", "Brazil", "United States"]},
        "presets": [
            {
                "id": "kz-steppe",
                "name": "Northern Kazakhstan",
                "description": "Steppe and cropland burning in spring and late summer",
                "geometry": bbox_polygon(**AREA),
            },
            {
                "id": "amazon-south",
                "name": "Southern Amazon",
                "description": "Burning season in August and September",
                "geometry": bbox_polygon(-62.0, -13.0, -52.0, -7.0),
            },
            {
                "id": "california-north",
                "name": "Northern California",
                "description": "Large wildfires in summer and autumn",
                "geometry": bbox_polygon(-124.0, 38.5, -120.0, 42.0),
            },
        ],
    }


def write_json(name: str, payload: dict) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    (EXAMPLES / name).write_text(text, encoding="utf-8", newline="\n")


def write_csv(name: str, header: list[str], rows: list[list]) -> None:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    (EXAMPLES / name).write_text(buffer.getvalue(), encoding="utf-8", newline="\n")


def main() -> None:
    EXAMPLES.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)

    values = build_series(rng)
    baseline = build_baseline(values)
    geometry = bbox_polygon(**AREA)

    calendar_response = build_calendar(values, baseline, "harmonized", rng)
    points = build_points(rng, 2010, 8, 12)

    write_json("health.json", {"status": "ok", "data_version": DATA_VERSION})
    write_json("meta.json", build_meta())
    write_json(
        "calendar.request.json",
        {
            "geometry": geometry,
            "start_year": 2000,
            "end_year": 2026,
            "baseline": {"start_year": BASELINE[0], "end_year": BASELINE[1]},
            "metric": "count",
            "series": "harmonized",
        },
    )
    write_json("calendar.response.json", calendar_response)
    write_json("calendar_raw.response.json", build_calendar(values, baseline, "raw", rng))
    write_json("current.response.json", build_current(rng))
    write_json("points.request.json", {"geometry": geometry, "year": 2010, "month": 8})
    write_json("points.response.json", points)
    write_json("daily.request.json", {"geometry": geometry, "year": 2010, "metric": "count"})
    write_json("daily.response.json", build_daily(rng, values, 2010))
    write_json(
        "export_points.request.json",
        {"geometry": geometry, "start_date": "2010-08-01", "end_date": "2010-08-31"},
    )
    write_json("method_validation.response.json", build_validation(rng))
    write_json(
        "error_area_too_large.json",
        {"error": {"code": "AREA_TOO_LARGE", "message": "The area is larger than 3,000,000 km². Reduce the area."}},
    )
    write_json(
        "error_invalid_geometry.json",
        {"error": {"code": "INVALID_GEOMETRY", "message": "The polygon is not closed or intersects itself."}},
    )
    write_json(
        "error_no_data.json",
        {"error": {"code": "NO_DATA", "message": "The area is outside the dataset coverage."}},
    )

    write_csv(
        "export_points.csv",
        ["lat", "lon", "acq_datetime", "sensor", "satellite", "conf_class", "frp", "daynight", "pixel_km2", "type", "quality", "harmonized_weight"],
        [
            [
                f["geometry"]["coordinates"][1],
                f["geometry"]["coordinates"][0],
                f["properties"]["acq_datetime"],
                f["properties"]["sensor"],
                f["properties"]["satellite"],
                f["properties"]["conf_class"],
                f["properties"]["frp"],
                f["properties"]["daynight"],
                1.0,
                0,
                f["properties"]["quality"],
                f["properties"]["harmonized_weight"],
            ]
            for f in points["features"]
        ],
    )
    write_csv(
        "export_calendar.csv",
        ["year", "month", "value", "low", "high", "median", "anomaly_pct", "percentile", "category", "source", "preliminary", "partial"],
        [
            [
                m["year"], m["month"], m["value"], m["low"], m["high"], m["median"],
                "" if m["anomaly_pct"] is None else m["anomaly_pct"],
                "" if m["percentile"] is None else m["percentile"],
                m["category"] or "",
                m["source"],
                str(m["preliminary"]).lower(),
                str(m["partial"]).lower(),
            ]
            for m in calendar_response["months"]
        ],
    )
    print(f"Examples written to {EXAMPLES}")


if __name__ == "__main__":
    main()
