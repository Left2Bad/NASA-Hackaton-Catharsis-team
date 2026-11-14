"""Step 6: validation report for the "Method" page: data/validation/report.json in the shape of ValidationResponse
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
 * Sensor gap days (data/gap_days.csv, harmonize.py) are left out of every check, on both sides of each comparison:
   the monthly grid is summed from data/grid_daily.parquet without those days (falls back to grid_monthly.parquet when
   either file is missing).

Checks that the contract's ValidationResponse has no field for go to data/validation/checks.json (and
docs/methodology.md):
 * terra_to_terra_aqua_2002: the third seam. Where Terra and Aqua both exist (2003-2011, before S-NPP), the Terra-only
   estimate sum(Terra x w_count_t) over the Terra + Aqua estimate sum((Terra + Aqua) x w_count_ta), whole world, per
   year and over the period, plus the same inside the fit window 2012-2020 for reference;
 * baselines per region, on the same months as the region metrics: raw MODIS (no coefficient) and MODIS x the single
   world coefficient. Pearson r is scale-free and follows the shared seasonal cycle, so it is the same for raw and
   harmonized MODIS; only bias and the median error show what the 1-degree coefficients add.
Lead-source rule and coefficient formulas come from pipeline/lead.py.

Usage: python pipeline/validation.py
"""

import argparse
import json
import math
import statistics
import sys
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
    "2000–2002: Terra only, one morning overpass — the error is 1.7–2.1 times higher than for Terra + Aqua, and in "
    "2003–2011 the Terra-only estimate runs about 3 % below the Terra + Aqua one.",
    "Days when the lead satellite did not report are filled from another one (NOAA-20 for Suomi NPP, Terra for Aqua); "
    "Terra outages in 2000–2012 cannot be filled, so those months are flagged as sensor gaps and may be understated.",
    "Active lava flows and gas flares: MODIS and VIIRS classify them differently, so such places are masked for all "
    "satellites and their coefficient comes from the surrounding 5° block; detections left there are less reliable.",
]
SEAM_2002 = {"id": "terra_to_terra_aqua_2002", "label": "MODIS Terra → Terra + Aqua transition, checked on 2003–2011",
             "years": (2003, 2011), "fit_years": (2012, 2020)}  # fmt: skip

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
    daily, gaps = data / "grid_daily.parquet", data / "gap_days.csv"
    if daily.exists() and gaps.exists():  # monthly sums without sensor gap days
        con.execute(f"""
        CREATE TABLE g AS
        SELECT iy, ix, date_trunc('month', date)::DATE AS month,
               sum(n_t) n_t, sum(n_a) n_a, sum(n_snpp) n_snpp, sum(n_n20) n_n20,
               sum(f_t) f_t, sum(f_a) f_a, sum(f_snpp) f_snpp, sum(f_n20) f_n20
        FROM read_parquet('{daily.as_posix()}')
        ANTI JOIN (SELECT DISTINCT date FROM read_csv('{gaps.as_posix()}', header=true,
                   columns={{'date': 'DATE', 'sensor': 'VARCHAR', 'ratio': 'DOUBLE'}})) USING (date)
        WHERE year(date) BETWEEN 2003 AND {TEST[1]}
        GROUP BY ALL""")
    else:
        con.execute(f"CREATE VIEW g AS SELECT * FROM read_parquet('{(data / 'grid_monthly.parquet').as_posix()}')")
    con.execute(f"CREATE VIEW w AS SELECT * FROM read_parquet('{(data / 'coefficients.parquet').as_posix()}')")
    return con


def region_series(con, bbox, outages, w_world=1.0):
    """Monthly test series of a region, its metrics, and the raw-MODIS and world-coefficient baselines."""
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
    compared = [(r, v, h) for m, r, v, h in rows if m not in outages]
    fact = [v for _, v, _ in compared]
    baselines = {
        "raw_modis": metrics([r for r, _, _ in compared], fact),
        "world_coefficient": metrics([r * w_world for r, _, _ in compared], fact),
    }
    return series, metrics([h for _, _, h in compared], fact), baselines


def seam_2002(con):
    """Terra-only estimate over the Terra + Aqua estimate where both satellites exist, per year and overall."""
    y0, y1 = SEAM_2002["years"]
    f0, f1 = SEAM_2002["fit_years"]
    rows = con.execute(f"""
    SELECT year(month) AS y, sum(g.n_t * w.w_count_t), sum((g.n_t + g.n_a) * w.w_count_ta), sum(g.n_t), sum(g.n_t + g.n_a)
    FROM g JOIN w ON w.cy = g.iy // 10 AND w.cx = g.ix // 10
    WHERE (year(month) BETWEEN {f0} AND {f1} AND month >= DATE '{lead.SNPP_START}') OR year(month) BETWEEN {y0} AND {y1}
    GROUP BY 1 ORDER BY 1""").fetchall()

    def ratio(years):
        sel = [r for r in rows if years[0] <= r[0] <= years[1]]
        return sum(r[1] for r in sel) / sum(r[2] for r in sel), sum(r[3] for r in sel) / sum(r[4] for r in sel)

    h, n = ratio((y0, y1))
    return {
        "id": SEAM_2002["id"],
        "label": SEAM_2002["label"],
        "ratio_harmonized": round(h, 3),
        "ratio_naive": round(n, 3),
        "ratio_harmonized_fit_window": round(ratio((f0, f1))[0], 3),
        "by_year": {str(y): round(t / ta, 3) for y, t, ta, _, _ in rows if y <= y1},
    }


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


def world_coefficient(data, con):
    """World Terra + Aqua count coefficient from harmonize.py (summary.json), else the median cell coefficient."""
    path = data / "harmonized" / "summary.json"
    if path.exists():
        g = json.loads(path.read_text(encoding="utf-8")).get("global_coefficients", {})
        if "count_ta" in g:
            return g["count_ta"]
    return con.execute("SELECT median(w_count_ta) FROM w").fetchone()[0]


def build_report(data=DATA):
    """(report.json payload in the contract's ValidationResponse shape, checks.json payload)."""
    outages = lead.load_outages(data / "outage_months.csv")
    con = connect(data)
    w_world = world_coefficient(data, con)
    regions, baselines = [], {}
    for rid, name, bbox in REGIONS:
        series, m, base = region_series(con, bbox, outages, w_world)
        regions.append({"id": rid, "name": name, "metrics": m, "series": series})
        baselines[rid] = {"harmonized": m, **base}
    seams = []
    for seam, fn in ((SEAM_2012, seam_2012), (SEAM_2026, seam_2026)):
        h, n = fn(con, outages)
        seams.append(
            {"id": seam["id"], "label": seam["label"], "ratio_harmonized": round(h, 3), "ratio_naive": round(n, 3)}
        )
    report = {
        "calibration_period": {"start_year": CALIB[0], "end_year": CALIB[1]},
        "test_period": {"start_year": TEST[0], "end_year": TEST[1]},
        "regions": regions,
        "seams": seams,
        "limitations": LIMITATIONS,
    }
    checks = {
        "gap_days_excluded": (data / "gap_days.csv").exists() and (data / "grid_daily.parquet").exists(),
        "world_coefficient_count_ta": round(w_world, 4),
        "region_baselines": baselines,
        "seam_2002": seam_2002(con),
    }
    return report, checks


def main(argv=(), data=DATA):
    ap = argparse.ArgumentParser(
        description="Validation report: data/validation/report.json (contract ValidationResponse) and checks.json."
    )
    ap.parse_args(list(argv))
    report, checks = build_report(data)
    out = data / "validation"
    out.mkdir(parents=True, exist_ok=True)
    for name, payload in (("report.json", report), ("checks.json", checks)):
        text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        (out / name).write_bytes(text.encode("utf-8"))
    for r in report["regions"]:
        print(r["id"], r["metrics"], flush=True)
        for k in ("raw_modis", "world_coefficient"):
            print("   baseline", k, checks["region_baselines"][r["id"]][k], flush=True)
    for s in [*report["seams"], checks["seam_2002"]]:
        print(s["id"], "harmonized", s["ratio_harmonized"], "naive", s["ratio_naive"], flush=True)
    print("2002 seam by year:", checks["seam_2002"]["by_year"], flush=True)
    return report


if __name__ == "__main__":
    main(sys.argv[1:])
