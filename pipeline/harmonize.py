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

import argparse
import datetime as dt
import json
import sys
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
GAP_WINDOW = 15  # days on each side for the local median of a daily sensor ratio
# a day below this share of its local ratio is a gap day. VIIRS daily ratios never fall between 0.5 and 0.6 outside
# outages; MODIS Terra/Aqua is noisier (0.5 % of days below x0.53), so it gets a lower threshold.
GAP_RATIO = {"modis": 0.25, "viirs": 0.5}
# Coefficient guard (R1): a 1-degree cell whose Terra + Aqua -> S-NPP count ratio (shrunk to the world value) is more
# than COEF_BAND times off the world ratio sees different targets in MODIS and VIIRS (gas flares, lava flows, static
# sources typed differently by the two products), not a difference in detection efficiency. In every MODIS set such a
# cell is left out of its 5-degree block and takes the block's value instead of its own ratio. The Terra + Aqua count
# ratio is the test because Terra-only ratios also carry a real diurnal signal (afternoon burning in Central Africa
# gives Terra-only ratios 10-35 times the world value with a normal Terra + Aqua ratio).
COEF_BAND = 4.0

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


M1_SUMS = """sum(n_t)::DOUBLE n_t, sum(n_a)::DOUBLE n_a, sum(n_snpp)::DOUBLE n_snpp, sum(n_n20)::DOUBLE n_n20,
           sum(f_t)::DOUBLE f_t, sum(f_a)::DOUBLE f_a, sum(f_snpp)::DOUBLE f_snpp, sum(f_n20)::DOUBLE f_n20"""


def load_grid(con, grid_path, daily_path=None):
    """1-degree x month table m1 and the list of all 1-degree cells.

    With `daily_path`, m1 is summed from the daily grid without the days in table `gap_days` (any sensor), so that
    a day on which one sensor did not report leaves both sides of every ratio.
    """
    if daily_path is not None:
        con.execute(f"""
        CREATE OR REPLACE TABLE m1 AS
        SELECT (iy // 10)::SMALLINT AS cy, (ix // 10)::SMALLINT AS cx, date_trunc('month', date)::DATE AS month,
               {M1_SUMS}
        FROM read_parquet('{Path(daily_path).as_posix()}') d
        ANTI JOIN (SELECT DISTINCT date FROM gap_days) USING (date)
        GROUP BY ALL""")
    else:
        con.execute(f"""
        CREATE OR REPLACE TABLE m1 AS
        SELECT (iy // 10)::SMALLINT AS cy, (ix // 10)::SMALLINT AS cx, month, {M1_SUMS}
        FROM read_parquet('{Path(grid_path).as_posix()}') GROUP BY ALL""")
    con.execute("CREATE OR REPLACE TABLE cells AS SELECT DISTINCT cy, cx FROM m1")


def find_gap_days(con, daily_path, last_day):
    """Days on which one sensor delivered (almost) nothing while the others reported normally -> table gap_days.

    Global daily counts per sensor are compared with another sensor, relative to the median of the same ratio over
    the surrounding +-GAP_WINDOW days (days with zero counts left out of the median, so a long outage cannot pull it
    down). A sensor has a gap day when the relative ratio is below GAP_RATIO (MODIS 0.25, VIIRS 0.5):
      terra  Terra-only era: Terra / its local median;  later: Terra / Aqua
      aqua   Aqua / Terra (from 2002-08)
      snpp   S-NPP / MODIS or S-NPP / NOAA-20, 2012-02 .. lead.SNPP_END
      n20    NOAA-20 / MODIS or NOAA-20 / S-NPP, from lead.N20_FIRST
    Days with no rows at all count as zero for every sensor. Only days up to `last_day` (the last complete day) are
    checked. Returns rows (date, sensor, ratio), ratio = the relative ratio (0 = no detections at all).
    """
    w = f"(ORDER BY date ROWS BETWEEN {GAP_WINDOW} PRECEDING AND {GAP_WINDOW} FOLLOWING)"
    con.execute(f"""
    CREATE OR REPLACE TABLE gd AS
    WITH s AS (SELECT date, sum(n_t)::DOUBLE t, sum(n_a)::DOUBLE a, sum(n_snpp)::DOUBLE s, sum(n_n20)::DOUBLE n
               FROM read_parquet('{Path(daily_path).as_posix()}') GROUP BY date),
         cal AS (SELECT unnest(generate_series(DATE '{lead.FIRST_DATE}', DATE '{last_day}', INTERVAL 1 DAY))::DATE date),
         d AS (SELECT cal.date, coalesce(t, 0) t, coalesce(a, 0) a, coalesce(s, 0) s, coalesce(n, 0) n
               FROM cal LEFT JOIN s USING (date)),
         r AS (SELECT *, t + a AS m,
                      t / median(nullif(t, 0)) OVER {w} AS t_rel,
                      (t / nullif(a, 0)) / median(nullif(t, 0) / nullif(a, 0)) OVER {w} AS ta_rel,
                      (s / nullif(t + a, 0)) / median(nullif(s, 0) / nullif(t + a, 0)) OVER {w} AS sm_rel,
                      (s / nullif(n, 0)) / median(nullif(s, 0) / nullif(n, 0)) OVER {w} AS sn_rel,
                      (n / nullif(t + a, 0)) / median(nullif(n, 0) / nullif(t + a, 0)) OVER {w} AS nm_rel,
                      (n / nullif(s, 0)) / median(nullif(n, 0) / nullif(s, 0)) OVER {w} AS ns_rel
               FROM d)
    SELECT * FROM r""")
    k, v = GAP_RATIO["modis"], GAP_RATIO["viirs"]
    rows = con.execute(f"""
    WITH g AS (
      SELECT date, 'terra' AS sensor,
             CASE WHEN date < DATE '{lead.AQUA_START}' THEN t_rel WHEN a > 0 THEN ta_rel ELSE 0 END AS ratio
      FROM gd WHERE (date < DATE '{lead.AQUA_START}' AND t_rel < {k})
                 OR (date >= DATE '{lead.AQUA_START}' AND (t = 0 OR ta_rel < {k}))
      UNION ALL
      SELECT date, 'aqua', CASE WHEN t > 0 THEN 1 / ta_rel ELSE 0 END
      FROM gd WHERE date >= DATE '{lead.AQUA_START}' AND (a = 0 OR ta_rel > 1 / {k})
      UNION ALL
      SELECT date, 'snpp', coalesce(least(sm_rel, sn_rel), 0)
      FROM gd WHERE date BETWEEN DATE '{lead.SNPP_START}' AND DATE '{lead.SNPP_END}'
                AND (s = 0 OR sm_rel < {v} OR sn_rel < {v})
      UNION ALL
      SELECT date, 'n20', coalesce(least(nm_rel, ns_rel), 0)
      FROM gd WHERE date >= DATE '{lead.N20_FIRST}' AND (n = 0 OR nm_rel < {v} OR ns_rel < {v}))
    SELECT date, sensor, round(ratio, 4) FROM g ORDER BY date, sensor""").fetchall()
    con.execute("CREATE OR REPLACE TABLE gap_days (date DATE, sensor VARCHAR, ratio DOUBLE)")
    if rows:
        con.executemany("INSERT INTO gap_days VALUES (?, ?, ?)", rows)
    return rows


def last_dates(con, data, daily_path):
    """last_date (last day in the grid), last_complete_date and last_standard_date, plus the last day per sensor.

    The FIRMS API conversion (api_to_parquet.py) records when the data were fetched: the fetch day itself is partial,
    so the last complete day is the day before. Archive-only builds are complete and standard through the last day.
    """
    if daily_path is not None:
        row = con.execute(f"""
        SELECT max(date), max(date) FILTER (WHERE n_t > 0), max(date) FILTER (WHERE n_a > 0),
               max(date) FILTER (WHERE n_snpp > 0), max(date) FILTER (WHERE n_n20 > 0)
        FROM read_parquet('{Path(daily_path).as_posix()}')""").fetchone()
    else:
        m = con.execute("SELECT max(month) FROM m1").fetchone()[0]
        end = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
        row = (end, None, None, None, None)
    last = row[0]
    complete, standard = last, last
    coverage = sorted((data / "points").glob("api_*.json"))
    if coverage:
        c = json.loads(coverage[-1].read_text(encoding="utf-8"))
        complete = min(last, dt.date.fromisoformat(c["complete_through"]))
        viirs_sp = [v["last_sp_date"] for k, v in c["sources"].items() if k != "modis" and v.get("last_sp_date")]
        if viirs_sp:  # VIIRS leads since 2012; the SP/NRT boundary of the lead
            standard = min(complete, dt.date.fromisoformat(min(viirs_sp)))
    sensors = dict(zip(("modis_terra", "modis_aqua", "viirs_snpp", "viirs_n20"), row[1:], strict=True))
    return last, complete, standard, {k: str(v) for k, v in sensors.items() if v}


def find_outages(con, until=lead.SNPP_END):
    """Months where S-NPP under-reports against NOAA-20 (satellite safe mode etc.)."""
    rows = con.execute(f"""
    WITH g AS (SELECT month, sum(n_snpp) / nullif(sum(n_n20), 0) q FROM m1
               WHERE month BETWEEN DATE '{lead.N20_FIRST}' AND DATE '{min(until, lead.SNPP_END)}' GROUP BY month)
    SELECT month, q FROM g WHERE q < {OUTAGE_THRESHOLD} * (SELECT median(q) FROM g) ORDER BY month""").fetchall()
    return [(m, q) for m, q in rows]


def months_sql(first, y0, y1, outages, last=None):
    """WHERE clause: overlap months of a pair inside [y0, y1], without S-NPP outages."""
    out = ", ".join(f"DATE '{m}'" for m in outages) or "DATE '1900-01-01'"  # NOT IN (NULL) would match nothing
    end = f"AND month <= DATE '{last}'" if last else ""
    return f"month >= DATE '{first}' AND year(month) BETWEEN {y0} AND {y1} {end} AND month NOT IN ({out})"


def fit(con, table, pair, where, band=COEF_BAND):
    """Shrunk, guarded ratio per 1-degree cell for one pair -> table(cy, cx, r, rg, outlier).

    r_block = (Y_block + A r_world) / (X_block + A) over the block's normal cells, r_cell = (Y + A r_block) / (X + A);
    a MODIS outlier cell (COEF_BAND) gets r_block. NOAA-20 sets have no outliers (both sensors are VIIRS).
    """
    basis, metric, y, x, xn, _ = PAIRS[pair]
    if metric == "count":
        a = A
    else:  # pseudo-count in FRP units: A detections times mean FRP per detection
        a = A * con.execute(f"SELECT sum({x}) / nullif(sum({xn}), 0) FROM m1 WHERE {where}").fetchone()[0]
    if basis.startswith("MODIS"):
        outlier = f"(ys + {A} * g.rta) / (xs + {A}) NOT BETWEEN g.rta / {band} AND g.rta * {band}"
    else:
        outlier = "false"
    con.execute(f"""
    CREATE OR REPLACE TABLE {table} AS
    WITH c AS (SELECT cy, cx, sum({y}) yv, sum({x}) xv, sum(n_snpp) ys, sum(n_t + n_a) xs
               FROM m1 WHERE {where} GROUP BY ALL),
         g AS (SELECT sum(yv) / sum(xv) rg, sum(ys) / sum(xs) rta FROM c),
         o AS (SELECT c.*, {outlier} AS outlier FROM c, g),
         b AS (SELECT cy // 5 AS by5, cx // 5 AS bx5,
                      (coalesce(sum(yv) FILTER (WHERE NOT outlier), 0) + {a} * any_value(g.rg))
                      / (coalesce(sum(xv) FILTER (WHERE NOT outlier), 0) + {a}) rb
               FROM o, g GROUP BY 1, 2)
    SELECT cells.cy, cells.cx,
           CASE WHEN o.outlier THEN coalesce(b.rb, g.rg)
                ELSE (coalesce(o.yv, 0) + {a} * coalesce(b.rb, g.rg)) / (coalesce(o.xv, 0) + {a}) END AS r,
           g.rg, coalesce(o.outlier, false) AS outlier
    FROM cells LEFT JOIN o USING (cy, cx)
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


def global_series(con, outages, gaps, coef_path, out_csv, daily_path=None, last_day=None):
    """Harmonized global monthly series (count and FRP) for docs and sanity checks.

    From the daily grid when it exists, so that gap days use their substitute source (lead.lead_source day rule);
    `source` is the month's regular lead source. Days after `last_day` (a partial fetch day) are left out.
    """
    coef = Path(coef_path).as_posix()
    if daily_path is not None:
        src = f"read_parquet('{Path(daily_path).as_posix()}')"
        rows = f"""SELECT iy // 10 AS cy, ix // 10 AS cx, date_trunc('month', date)::DATE AS month,
                          {lead.lead_sql("date", frozenset(outages), gaps)} AS day_source, * EXCLUDE (iy, ix)
                   FROM {src} WHERE date <= DATE '{last_day}'"""
    else:
        rows = f"SELECT *, {lead.lead_sql('month', frozenset(outages))} AS day_source FROM m1"
    con.execute(f"""
    COPY (
      WITH v AS (
        SELECT d.month, {lead.lead_sql("d.month", frozenset(outages))} AS source,
               {lead.value_sql("count", "d", "w", "d.day_source")} AS hotspots,
               {lead.value_sql("frp", "d", "w", "d.day_source")} AS frp_mw,
               d.n_t + d.n_a AS modis, d.n_snpp, d.n_n20
        FROM ({rows}) d JOIN read_parquet('{coef}') w USING (cy, cx))
      SELECT year(month) AS year, month(month) AS month, any_value(source) AS source,
             round(sum(hotspots), 1) AS hotspots, round(sum(frp_mw), 1) AS frp_mw,
             sum(modis)::BIGINT AS modis, sum(n_snpp)::BIGINT AS viirs_snpp, sum(n_n20)::BIGINT AS viirs_n20
      FROM v GROUP BY ALL ORDER BY 1, 2)
    TO '{Path(out_csv).as_posix()}' (HEADER)""")


def coefficient_stats(con, coef_path):
    """Largest coefficient per set and how many cells the guard kept out of their blocks."""
    names = {p: f"w_{p}" for p in PAIRS}
    maxes = con.execute(
        "SELECT "
        + ", ".join(f"max({n})" for n in names.values())
        + f" FROM read_parquet('{Path(coef_path).as_posix()}')"
    ).fetchone()
    out = {}
    for (p, _), m in zip(names.items(), maxes, strict=True):
        n_out, x_out, x_all = con.execute(f"""
        SELECT count(*) FILTER (WHERE outlier), coalesce(sum(xv) FILTER (WHERE outlier), 0), sum(xv)
        FROM r_{p} JOIN (SELECT cy, cx, sum({PAIRS[p][3]}) xv FROM m1
                         WHERE {months_sql(PAIRS[p][5], *fit_years(p), [], last=OVERLAP_END)} GROUP BY ALL) USING (cy, cx)""").fetchone()
        out[p] = {"max": round(m, 2), "outlier_cells": n_out, "outlier_source_share_pct": round(x_out / x_all * 100, 3)}
    return out


def write_csv(path, header, rows):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(header + "\n")
        for r in rows:
            f.write(",".join(str(v) for v in r) + "\n")


def main(argv=(), data=DATA):
    ap = argparse.ArgumentParser(
        description="Coefficients, uncertainty, gap days and validation from data/grid_daily.parquet and "
        "data/grid_monthly.parquet (writes data/coefficients.parquet, uncertainty.parquet, outage_months.csv, "
        "gap_days.csv and data/harmonized/)."
    )
    ap.parse_args(list(argv))
    (data / "harmonized").mkdir(parents=True, exist_ok=True)
    daily = data / "grid_daily.parquet"
    daily = daily if daily.exists() else None
    con = connect(data)
    load_grid(con, data / "grid_monthly.parquet")
    found = find_outages(con)
    outages = [m for m, _ in found]
    write_csv(data / "outage_months.csv", "month,snpp_per_n20", [(f"{m:%Y-%m}", f"{q:.4f}") for m, q in found])
    print("S-NPP outage months:", [f"{m:%Y-%m}" for m in outages], flush=True)

    last, complete, standard, sensor_last = last_dates(con, data, daily)
    print(f"last day {last}, last complete day {complete}, last standard-processing day {standard}", flush=True)
    gap_rows = find_gap_days(con, daily, complete) if daily else []
    if not daily:
        con.execute("CREATE OR REPLACE TABLE gap_days (date DATE, sensor VARCHAR, ratio DOUBLE)")
    write_csv(data / "gap_days.csv", "date,sensor,ratio", gap_rows)
    gaps = lead.load_gap_days(data / "gap_days.csv")
    flagged = sorted(lead.gap_months(frozenset(outages), gaps))
    subs = lead.substitutions(frozenset(outages), gaps)
    counts = {s: sum(1 for _, g, _ in gap_rows if g == s) for s in lead.GAP_SENSORS}
    print(
        f"gap days {counts}; {len(subs)} days filled from another sensor; sensor_gap months: {len(flagged)}", flush=True
    )
    if daily:
        load_grid(con, None, daily)  # fits and checks without gap days

    con.execute("DROP TABLE IF EXISTS vp")
    main_check = validate(con, outages, "contract", CALIB, TEST)
    modis_pairs = [p for p in PAIRS if PAIRS[p][0].startswith("MODIS")]
    nominal_check = validate(con, outages, "nominal_orbit", NOMINAL_CALIB, NOMINAL_TEST, modis_pairs)
    uncertainty(con, data / "uncertainty.parquet")
    globals_ = production(con, outages, data / "coefficients.parquet")
    guard = coefficient_stats(con, data / "coefficients.parquet")
    global_series(
        con, outages, gaps, data / "coefficients.parquet", data / "harmonized" / "global_monthly.csv", daily, complete
    )

    summary = {
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "last_date": str(last),
        "last_complete_date": str(complete),
        "last_standard_date": str(standard),
        "sensor_last_dates": sensor_last,
        "grid_deg": 0.1,
        "coefficient_cell_deg": 1,
        "shrinkage": {"pseudo_count": A, "hierarchy": ["1deg cell", "5deg block", "global"]},
        "coefficient_guard": {"band": COEF_BAND, "sets": guard},
        "periods": [{"id": i, "start": str(s), "end": str(e) if e else None} for i, s, e in lead.PERIODS],
        "global_coefficients": {k: round(v, 4) for k, v in globals_.items()},
        "outage_months": [f"{m:%Y-%m}" for m in outages],
        "gap_days": counts,
        "substituted_days": len(subs),
        "sensor_gap_months": [f"{m:%Y-%m}" for m in flagged],
        "coefficient_fit_years": {p: list(fit_years(p)) for p in PAIRS},
        "validation": {"unit": "5deg block x month", "contract": main_check, "nominal_orbit": nominal_check},
    }
    (data / "harmonized" / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), "utf-8")
    print("global coefficients:", summary["global_coefficients"], flush=True)
    print("largest coefficients:", {p: v["max"] for p, v in guard.items()}, flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
