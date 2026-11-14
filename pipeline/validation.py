"""Validation report for the "Method" page: data/validation/report.json in the shape of ValidationResponse
(contract/openapi.yaml).

 * Regions: three presets (same boxes as backend/app/schemas.py PRESETS), 60 test months 2021-2025.
   modis_raw = Terra + Aqua, viirs_raw = S-NPP, harmonized = MODIS x 1-degree coefficient from data/coefficients.parquet
   (MODIS coefficients are fitted on 2012-2020 only, see harmonize.MODIS_FIT_YEARS, so 2021-2025 is out of sample).
   Metrics compare harmonized (forecast) with S-NPP (fact); S-NPP outage months (data/outage_months.csv) stay in the
   series but are left out of the metrics, because there the "fact" itself under-reports.
     pearson_r, bias_pct = (sum forecast / sum fact - 1) * 100,
     mape_pct = median over months with fact > 0 of |forecast - fact| / fact * 100, n_months = months compared.
 * Seams, whole world:
     modis_to_snpp_2012: mean 2012-2014 / mean 2009-2011 of the harmonized series (lead source x coefficient)
                         and of the naive one (raw lead source: raw MODIS before the seam, raw S-NPP after);
     snpp_to_n20_2026:   2024-2025 without S-NPP outages, sum(N20 x coefficient) / sum(S-NPP) and sum(N20) / sum(S-NPP).
Lead-source rule and coefficient formulas come from pipeline/lead.py.
"""

import json
import math
import statistics
from pathlib import Path

import duckdb

import lead

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CALIB = (2012, 2020)
TEST = (2021, 2025)

# (id, name, (west, south, east, north)) — the presets served by /meta
REGIONS = [
    ("kz-steppe", "Northern Kazakhstan", (61.0, 51.0, 71.0, 55.0)),
    ("amazon-south", "Southern Amazon", (-62.0, -13.0, -52.0, -7.0)),
    ("california-north", "Northern California", (-124.0, 38.5, -120.0, 42.0)),
]

SEAM_2012 = {"id": "modis_to_snpp_2012", "label": "MODIS → Suomi NPP transition, 2009–2011 vs 2012–2014",
             "before": (2009, 2011), "after": (2012, 2014)}  # fmt: skip
SEAM_2026 = {"id": "snpp_to_n20_2026", "label": "Suomi NPP → NOAA-20 transition, checked on 2024–2025",
             "years": (2024, 2025)}  # fmt: skip

LIMITATIONS = [  # docs/methodology.md, section 7
    "Small fires that VIIRS (375 m) sees and MODIS (1 km) does not are recovered before 2012 only "
    "statistically: the coefficient carries over the average ratio, not individual events.",
    "In small areas (smaller than a 1° cell) the coefficient is taken from the cell or the 5° block — the estimate is coarser and the interval wider.",
    "2000–2002: Terra only, one morning overpass — the error is roughly one and a half times higher than for Terra + Aqua.",
    "Satellite outages outside the detected outage months look like periods of low activity.",
]

# a coefficients row of ones: lead.value_sql over it gives the raw count of the same source
UNIT_COEF = "(SELECT 1.0::DOUBLE AS w_count_t, 1.0::DOUBLE AS w_count_ta, 1.0::DOUBLE AS w_count_n20) one"


def metrics(forecast, fact):
    """Contract metrics of a forecast against the fact (equal-length sequences of numbers)."""
    total = sum(fact)
    errors = [abs(p - a) / a * 100 for p, a in zip(forecast, fact, strict=True) if a > 0]
    r = statistics.correlation(forecast, fact) if len(fact) > 1 and len(set(fact)) > 1 else None
    return {
        "pearson_r": round(r, 3) if r is not None else None,
        "bias_pct": round((sum(forecast) / total - 1) * 100, 1) if total else None,
        "mape_pct": round(statistics.median(errors), 1) if errors else None,
        "n_months": len(fact),
    }


def cell_range(lo, hi):
    """0.1-degree grid indices whose centres lie strictly inside (lo, hi) degrees, offset already applied."""
    return math.floor(lo * 10 - 0.5) + 1, math.ceil(hi * 10 - 0.5) - 1


def connect(data):
    con = duckdb.connect()
    con.execute(f"SET memory_limit='8GB'; SET temp_directory='{(data / '_tmp' / 'spill').as_posix()}'")
    con.execute(f"CREATE VIEW g AS SELECT * FROM read_parquet('{(data / 'grid_monthly.parquet').as_posix()}')")
    con.execute(f"CREATE VIEW w AS SELECT * FROM read_parquet('{(data / 'coefficients.parquet').as_posix()}')")
    return con


def region_series(con, bbox, outages):
    west, south, east, north = bbox
    iy0, iy1 = cell_range(south + 90, north + 90)
    ix0, ix1 = cell_range(west + 180, east + 180)
    rows = con.execute(f"""
    WITH m AS (
      SELECT month,
             sum({lead.value_sql("count", "g", "one", "'MODIS_TA'")}) AS modis_raw,
             sum({lead.value_sql("count", "g", "one", "'VIIRS_SNPP'")}) AS viirs_raw,
             sum({lead.value_sql("count", "g", "w", "'MODIS_TA'")}) AS harmonized
      FROM g JOIN w ON w.cy = g.iy // 10 AND w.cx = g.ix // 10, {UNIT_COEF}
      WHERE g.iy BETWEEN {iy0} AND {iy1} AND g.ix BETWEEN {ix0} AND {ix1}
        AND year(month) BETWEEN {TEST[0]} AND {TEST[1]}
      GROUP BY month),
    months AS (SELECT unnest(generate_series(DATE '{TEST[0]}-01-01', DATE '{TEST[1]}-12-01', INTERVAL 1 MONTH))::DATE
               AS month)
    SELECT month, coalesce(modis_raw, 0)::DOUBLE, coalesce(viirs_raw, 0)::DOUBLE, coalesce(harmonized, 0)::DOUBLE
    FROM months LEFT JOIN m USING (month) ORDER BY month""").fetchall()
    series = [
        {
            "year": m.year,
            "month": m.month,
            "modis_raw": round(r, 1),
            "viirs_raw": round(v, 1),
            "harmonized": round(h, 1),
        }
        for m, r, v, h in rows
    ]
    compared = [(h, v) for m, _, v, h in rows if m not in outages]
    return series, metrics([h for h, _ in compared], [v for _, v in compared])


def seam_2012(con, outages):
    before, after = SEAM_2012["before"], SEAM_2012["after"]
    src = lead.lead_sql("g.month", outages)
    rows = con.execute(f"""
    WITH v AS (
      SELECT year(g.month) BETWEEN {after[0]} AND {after[1]} AS post,
             {lead.value_sql("count", "g", "w", "src")} AS harmonized,
             {lead.value_sql("count", "g", "one", "src")} AS naive
      FROM (SELECT *, {src} AS src FROM g WHERE year(month) BETWEEN {before[0]} AND {after[1]}) g
           JOIN w ON w.cy = g.iy // 10 AND w.cx = g.ix // 10, {UNIT_COEF})
    SELECT post, sum(harmonized), sum(naive) FROM v GROUP BY post ORDER BY post""").fetchall()
    (_, h0, n0), (_, h1, n1) = rows
    k = (before[1] - before[0] + 1) / (after[1] - after[0] + 1)  # sums -> means
    return h1 / h0 * k, n1 / n0 * k


def seam_2026(con, outages):
    y0, y1 = SEAM_2026["years"]
    out = ", ".join(f"DATE '{m}'" for m in sorted(outages)) or "DATE '1900-01-01'"  # NOT IN (NULL) matches nothing
    h, n, s = con.execute(f"""
    SELECT sum({lead.value_sql("count", "g", "w", "'VIIRS_N20'")}),
           sum({lead.value_sql("count", "g", "one", "'VIIRS_N20'")}),
           sum({lead.value_sql("count", "g", "one", "'VIIRS_SNPP'")})
    FROM g JOIN w ON w.cy = g.iy // 10 AND w.cx = g.ix // 10, {UNIT_COEF}
    WHERE year(month) BETWEEN {y0} AND {y1} AND month NOT IN ({out})""").fetchone()
    return h / s, n / s


def build_report(data=DATA):
    outages = lead.load_outages(data / "outage_months.csv")
    con = connect(data)
    regions = []
    for rid, name, bbox in REGIONS:
        series, m = region_series(con, bbox, outages)
        regions.append({"id": rid, "name": name, "metrics": m, "series": series})
    seams = []
    for seam, fn in ((SEAM_2012, seam_2012), (SEAM_2026, seam_2026)):
        h, n = fn(con, outages)
        seams.append(
            {"id": seam["id"], "label": seam["label"], "ratio_harmonized": round(h, 3), "ratio_naive": round(n, 3)}
        )
    return {
        "calibration_period": {"start_year": CALIB[0], "end_year": CALIB[1]},
        "test_period": {"start_year": TEST[0], "end_year": TEST[1]},
        "regions": regions,
        "seams": seams,
        "limitations": LIMITATIONS,
    }


def main(data=DATA):
    report = build_report(data)
    out = data / "validation" / "report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for r in report["regions"]:
        print(r["id"], r["metrics"], flush=True)
    for s in report["seams"]:
        print(s["id"], "harmonized", s["ratio_harmonized"], "naive", s["ratio_naive"], flush=True)
    return report


if __name__ == "__main__":
    main()
