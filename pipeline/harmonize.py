"""Harmonization coefficients, uncertainty intervals and validation, built on data/grid_monthly.parquet.

Method (docs/methodology.md):
 * Input: 0.1-degree monthly grid with raw counts / FRP per satellite (pipeline/grid.py), already filtered.
 * Coefficient = ratio of S-NPP to the other source over the overlap, per 1-degree cell, with
   empirical-Bayes shrinkage: cell -> 5-degree block -> global.
      r_block = (Y_b + A * r_global) / (X_b + A),   r_cell = (Y_c + A * r_block) / (X_c + A)
   A = 50 detections of the source sensor (for FRP: 50 x mean FRP per detection).
   Six coefficient sets: {count, frp} x {MODIS Terra+Aqua, MODIS Terra only, NOAA-20} -> S-NPP.
 * S-NPP outage months: global S-NPP / NOAA-20 ratio < 85 % of its median; NOAA-20 leads there (pipeline/lead.py).
 * Validation: fit on CALIB years, predict S-NPP from the other source on TEST years, compare per 5-degree block x month.
 * Uncertainty: on the same test pairs, quantiles q10/q90 of actual/predicted, binned by the predicted magnitude.

Outputs:
  data/coefficients.parquet   cy, cx (1-degree cell: floor(lat+90), floor(lon+180)), w_count_ta, w_count_t, w_count_n20,
                              w_frp_ta, w_frp_t, w_frp_n20 — production fit on the whole overlap
  data/uncertainty.parquet    basis, metric, bin, q10, q90, n   (bin = floor(log10(value + 1) * 2))
  data/outage_months.csv      month (YYYY-MM), snpp_per_n20
  data/harmonized/summary.json, data/harmonized/global_monthly.csv
"""

import datetime as dt
import json
from pathlib import Path

import duckdb

import lead

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
A = 50.0  # shrinkage pseudo-count, in detections of the source sensor
OUTAGE_THRESHOLD = 0.85
CALIB = (2012, 2020)  # validation reported in the API contract: fit 2012-2020, test 2021-2025
TEST = (2021, 2025)
NOMINAL_CALIB = (2012, 2016)  # second check inside the nominal-orbit era: fit 2012-2016, test 2017-2020
NOMINAL_TEST = (2017, 2020)
# Terra and Aqua left their maintained orbits around 2020-2022: Terra's overpass drifts earlier, Aqua's later,
# and the S-NPP/Terra ratio climbs from ~12.3 (2012-2021) to 16.5 (2025). Historical MODIS (2000-2012) flew nominal
# orbits, so MODIS coefficients are fitted on 2012-2020 only. NOAA-20 coefficients use the whole overlap.
MODIS_FIT_YEARS = (2012, 2020)
OVERLAP_END = dt.date(2025, 12, 31)  # last month with complete standard data
MIN_BIN_N = 30

# pair id -> (basis, metric, target column, source column, source count column, first month of overlap)
PAIRS = {
    "count_ta": ("MODIS_TA", "count", "n_snpp", "n_t + n_a", "n_t + n_a", lead.SNPP_START),
    "count_t": ("MODIS_T", "count", "n_snpp", "n_t", "n_t", lead.SNPP_START),
    "count_n20": ("VIIRS_N20", "count", "n_snpp", "n_n20", "n_n20", lead.N20_FIRST),
    "frp_ta": ("MODIS_TA", "frp", "f_snpp", "f_t + f_a", "n_t + n_a", lead.SNPP_START),
    "frp_t": ("MODIS_T", "frp", "f_snpp", "f_t", "n_t", lead.SNPP_START),
    "frp_n20": ("VIIRS_N20", "frp", "f_snpp", "f_n20", "n_n20", lead.N20_FIRST),
}


def fit_years(pair):
    return MODIS_FIT_YEARS if PAIRS[pair][0].startswith("MODIS") else (lead.N20_FIRST.year, OVERLAP_END.year)


def connect(data=DATA):
    con = duckdb.connect()
    con.execute(f"SET memory_limit='8GB'; SET temp_directory='{(data / '_tmp' / 'spill').as_posix()}'")
    return con


def load_grid(con, grid_path):
    """1-degree x month table m1 and the list of all 1-degree cells."""
    con.execute(f"""
    CREATE OR REPLACE TABLE m1 AS
    SELECT (iy // 10)::SMALLINT AS cy, (ix // 10)::SMALLINT AS cx, month,
           sum(n_t)::DOUBLE n_t, sum(n_a)::DOUBLE n_a, sum(n_snpp)::DOUBLE n_snpp, sum(n_n20)::DOUBLE n_n20,
           sum(f_t)::DOUBLE f_t, sum(f_a)::DOUBLE f_a, sum(f_snpp)::DOUBLE f_snpp, sum(f_n20)::DOUBLE f_n20
    FROM read_parquet('{Path(grid_path).as_posix()}') GROUP BY ALL""")
    con.execute("CREATE OR REPLACE TABLE cells AS SELECT DISTINCT cy, cx FROM m1")


def find_outages(con, until=OVERLAP_END):
    """Months where S-NPP under-reports against NOAA-20 (satellite safe mode etc.)."""
    rows = con.execute(f"""
    WITH g AS (SELECT month, sum(n_snpp) / nullif(sum(n_n20), 0) q FROM m1
               WHERE month BETWEEN DATE '{lead.N20_FIRST}' AND DATE '{min(until, lead.SNPP_END)}' GROUP BY month)
    SELECT month, q FROM g WHERE q < {OUTAGE_THRESHOLD} * (SELECT median(q) FROM g) ORDER BY month""").fetchall()
    return [(m, q) for m, q in rows]


def months_sql(first, y0, y1, outages, last=None):
    """WHERE clause: overlap months of a pair inside [y0, y1], without S-NPP outages."""
    out = ", ".join(f"DATE '{m}'" for m in outages) or "NULL"
    end = f"AND month <= DATE '{last}'" if last else ""
    return f"month >= DATE '{first}' AND year(month) BETWEEN {y0} AND {y1} {end} AND month NOT IN ({out})"


def fit(con, table, pair, where):
    """Shrunk ratio per 1-degree cell for one pair -> table(cy, cx, r, rg)."""
    _, metric, y, x, xn, _ = PAIRS[pair]
    if metric == "count":
        a = A
    else:  # pseudo-count in FRP units: A detections times mean FRP per detection
        a = A * con.execute(f"SELECT sum({x}) / nullif(sum({xn}), 0) FROM m1 WHERE {where}").fetchone()[0]
    con.execute(f"""
    CREATE OR REPLACE TABLE {table} AS
    WITH c AS (SELECT cy, cx, sum({y}) yv, sum({x}) xv FROM m1 WHERE {where} GROUP BY ALL),
         g AS (SELECT sum(yv) / sum(xv) rg FROM c),
         b AS (SELECT cy // 5 AS by5, cx // 5 AS bx5,
                      (sum(yv) + {a} * any_value(g.rg)) / (sum(xv) + {a}) rb
               FROM c, g GROUP BY 1, 2)
    SELECT cells.cy, cells.cx,
           (coalesce(c.yv, 0) + {a} * coalesce(b.rb, g.rg)) / (coalesce(c.xv, 0) + {a}) AS r, g.rg
    FROM cells LEFT JOIN c USING (cy, cx)
         LEFT JOIN b ON b.by5 = cells.cy // 5 AND b.bx5 = cells.cx // 5, g""")


def validate(con, outages, experiment, calib, test, pairs=PAIRS):
    """Fit on `calib`, predict `test` per 5-degree block x month. Returns metrics and appends rows to table vp."""
    con.execute(
        "CREATE TABLE IF NOT EXISTS vp (experiment VARCHAR, pair VARCHAR, basis VARCHAR, metric VARCHAR,"
        " actual DOUBLE, pred DOUBLE, pred_g DOUBLE)"
    )
    metrics = {}
    for pair in pairs:
        basis, metric, y, x, _, first = PAIRS[pair]
        fit(con, "r_val", pair, months_sql(first, *calib, outages))
        con.execute(f"""
        INSERT INTO vp
        SELECT '{experiment}', '{pair}', '{basis}', '{metric}', sum({y}), sum(({x}) * r.r), sum({x}) * any_value(r.rg)
        FROM m1 JOIN r_val r USING (cy, cx)
        WHERE {months_sql(first, *test, outages)}
        GROUP BY cy // 5, cx // 5, month""")
        m = con.execute(f"""
        SELECT corr(actual, pred), sum(abs(pred - actual)) / sum(actual), sum(pred) / sum(actual) - 1,
               corr(actual, pred_g), sum(abs(pred_g - actual)) / sum(actual), count(*)
        FROM vp WHERE experiment = '{experiment}' AND pair = '{pair}'""").fetchone()
        metrics[pair] = {
            "pearson_r": round(m[0], 4),
            "wape_pct": round(m[1] * 100, 2),
            "bias_pct": round(m[2] * 100, 2),
            "pearson_r_global_coef": round(m[3], 4),
            "wape_pct_global_coef": round(m[4] * 100, 2),
            "n_block_months": m[5],
        }
        print(experiment, pair, metrics[pair], flush=True)
    return {"calibration_period": list(calib), "test_period": list(test), "pairs": metrics}


def uncertainty(con, out_path):
    """q10/q90 of actual/pred by predicted magnitude; sparse bins borrow from the nearest dense bin."""
    con.execute("""
    CREATE OR REPLACE TABLE u0 AS
    SELECT basis, metric, floor(log10(pred + 1) * 2)::INTEGER AS bin,
           quantile_cont(actual / pred, 0.1) q10, quantile_cont(actual / pred, 0.9) q90, count(*) n
    FROM vp WHERE pred > 0
      -- MODIS intervals from the nominal-orbit experiment (the era they are applied to), NOAA-20 from the main one
      AND experiment = CASE WHEN basis LIKE 'MODIS%' THEN 'nominal_orbit' ELSE 'contract' END
    GROUP BY ALL""")
    con.execute(
        """
    CREATE OR REPLACE TABLE u AS
    SELECT a.basis, a.metric, a.bin,
           arg_min(b.q10, abs(b.bin - a.bin) * 2 - (b.bin > a.bin)::INTEGER) q10,
           arg_min(b.q90, abs(b.bin - a.bin) * 2 - (b.bin > a.bin)::INTEGER) q90,
           any_value(a.n) n
    FROM u0 a JOIN u0 b ON a.basis = b.basis AND a.metric = b.metric AND b.n >= ?
    GROUP BY ALL ORDER BY 1, 2, 3""".replace("?", str(MIN_BIN_N))
    )
    con.execute(f"COPY u TO '{Path(out_path).as_posix()}' (FORMAT parquet)")


def production(con, outages, out_path):
    """Production coefficients (MODIS: 2012-2020, NOAA-20: whole overlap) -> data/coefficients.parquet."""
    globals_ = {}
    for pair, (_, _, _, _, _, first) in PAIRS.items():
        fit(con, f"r_{pair}", pair, months_sql(first, *fit_years(pair), outages, last=OVERLAP_END))
        globals_[pair] = con.execute(f"SELECT any_value(rg) FROM r_{pair}").fetchone()[0]
    names = {"count_ta": "w_count_ta", "count_t": "w_count_t", "count_n20": "w_count_n20",
             "frp_ta": "w_frp_ta", "frp_t": "w_frp_t", "frp_n20": "w_frp_n20"}  # fmt: skip
    cols = ", ".join(f"r_{p}.r::FLOAT AS {n}" for p, n in names.items())
    joins = " ".join(f"JOIN r_{p} USING (cy, cx)" for p in list(names)[1:])
    con.execute(f"""
    COPY (SELECT cy, cx, {cols} FROM r_count_ta {joins} ORDER BY cy, cx)
    TO '{Path(out_path).as_posix()}' (FORMAT parquet)""")
    return globals_


def global_series(con, outages, coef_path, out_csv):
    """Harmonized global monthly series (count and FRP) for docs and sanity checks."""
    con.execute(f"""
    COPY (
      WITH v AS (
        SELECT m1.month, {lead.lead_sql("m1.month", frozenset(outages))} AS source,
               {lead.value_sql("count", "m1", "w")} AS hotspots, {lead.value_sql("frp", "m1", "w")} AS frp_mw,
               m1.n_t + m1.n_a AS modis, m1.n_snpp, m1.n_n20
        FROM m1 JOIN read_parquet('{Path(coef_path).as_posix()}') w USING (cy, cx))
      SELECT year(month) AS year, month(month) AS month, any_value(source) AS source,
             round(sum(hotspots), 1) AS hotspots, round(sum(frp_mw), 1) AS frp_mw,
             sum(modis)::BIGINT AS modis, sum(n_snpp)::BIGINT AS viirs_snpp, sum(n_n20)::BIGINT AS viirs_n20
      FROM v GROUP BY ALL ORDER BY 1, 2)
    TO '{Path(out_csv).as_posix()}' (HEADER)""")


def main(data=DATA):
    (data / "harmonized").mkdir(parents=True, exist_ok=True)
    con = connect(data)
    load_grid(con, data / "grid_monthly.parquet")
    outages = [m for m, _ in find_outages(con)]
    with open(data / "outage_months.csv", "w", encoding="utf-8", newline="\n") as f:
        f.write("month,snpp_per_n20\n")
        for m, q in find_outages(con):
            f.write(f"{m:%Y-%m},{q:.4f}\n")
    print("S-NPP outage months:", [f"{m:%Y-%m}" for m in outages], flush=True)

    con.execute("DROP TABLE IF EXISTS vp")
    main_check = validate(con, outages, "contract", CALIB, TEST)
    modis_pairs = [p for p in PAIRS if PAIRS[p][0].startswith("MODIS")]
    nominal_check = validate(con, outages, "nominal_orbit", NOMINAL_CALIB, NOMINAL_TEST, modis_pairs)
    uncertainty(con, data / "uncertainty.parquet")
    globals_ = production(con, outages, data / "coefficients.parquet")
    global_series(con, outages, data / "coefficients.parquet", data / "harmonized" / "global_monthly.csv")

    summary = {
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "grid_deg": 0.1,
        "coefficient_cell_deg": 1,
        "shrinkage": {"pseudo_count": A, "hierarchy": ["1deg cell", "5deg block", "global"]},
        "periods": [{"id": i, "start": str(s), "end": str(e) if e else None} for i, s, e in lead.PERIODS],
        "global_coefficients": {k: round(v, 4) for k, v in globals_.items()},
        "outage_months": [f"{m:%Y-%m}" for m in outages],
        "coefficient_fit_years": {p: list(fit_years(p)) for p in PAIRS},
        "validation": {"unit": "5deg block x month", "contract": main_check, "nominal_orbit": nominal_check},
    }
    (data / "harmonized" / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), "utf-8")
    print("global coefficients:", summary["global_coefficients"], flush=True)


if __name__ == "__main__":
    main()
