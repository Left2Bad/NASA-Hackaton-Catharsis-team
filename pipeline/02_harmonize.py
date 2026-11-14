"""Step 2: monthly grid aggregates + MODIS->VIIRS harmonization.

Method (documented in data/harmonized/METHOD.md):
 * Filter: type==0 (vegetation fire; drops volcanoes, static industrial sources, offshore),
   conf_class != 'l' (drop low confidence).
 * Count hotspots per 0.25deg cell per month, per source (MODIS Terra, MODIS Aqua, VIIRS S-NPP).
 * Overlap 2012-03..2025-12: VIIRS S-NPP vs MODIS counts. Cell ratio estimated on 1deg cells
   with empirical-Bayes shrinkage toward the country ratio, which is shrunk toward the global ratio:
      r = (V + a*r_prior) / (M + a),  a = pseudo-count of MODIS detections
   Separate ratios for MODIS Terra+Aqua and Terra-only (used before Aqua, i.e. < 2002-07).
 * Harmonized series (VIIRS-S-NPP-equivalent hotspot counts):
      >= 2012-03 : VIIRS S-NPP observed
      <  2012-03 : MODIS (Terra+Aqua, or Terra only before 2002-07) * r_cell
 * Validation: fit on 2012-2018, predict VIIRS from MODIS for 2019-2025, report errors.
"""
import json
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parents[1]
PQ = (ROOT / "data" / "points").as_posix()
OUT = ROOT / "data" / "harmonized"
OUT.mkdir(parents=True, exist_ok=True)
A = 50.0           # shrinkage pseudo-count
VIIRS_START = "2012-03-01"
AQUA_START = "2002-07-01"

con = duckdb.connect(str(OUT / "work.duckdb"))
con.execute("SET threads=8; SET memory_limit='8GB'")
o = OUT.as_posix()

print("aggregating...", flush=True)
con.execute(f"""
CREATE OR REPLACE TABLE m AS
SELECT floor(lat*4)/4 + 0.125 AS clat, floor(lon*4)/4 + 0.125 AS clon,
       any_value(country) AS country,
       date_trunc('month', acq_date)::DATE AS month,
       count(*) FILTER (WHERE source='modis' AND satellite IN ('Terra','T')) AS modis_t,
       count(*) FILTER (WHERE source='modis' AND satellite IN ('Aqua','A')) AS modis_a,
       count(*) FILTER (WHERE source='viirs-snpp') AS viirs_snpp,
       count(*) FILTER (WHERE source='viirs-jpss1') AS viirs_n20,
       coalesce(sum(frp) FILTER (WHERE source='modis' AND satellite IN ('Terra','T')), 0) AS frp_modis_t,
       coalesce(sum(frp) FILTER (WHERE source='modis' AND satellite IN ('Aqua','A')), 0) AS frp_modis_a,
       coalesce(sum(frp) FILTER (WHERE source='viirs-snpp'), 0) AS frp_viirs,
       coalesce(sum(frp) FILTER (WHERE source='viirs-jpss1'), 0) AS frp_n20
FROM read_parquet('{PQ}/*.parquet')
WHERE type = 0 AND conf_class <> 'l'
GROUP BY ALL
""")
print(con.execute("SELECT count(*), min(month), max(month) FROM m").fetchall(), flush=True)


def fit(table, y0, y1):
    """Ratios on 1deg cells, shrunk to country then global."""
    con.execute(f"""
    CREATE OR REPLACE TABLE {table} AS
    WITH ov AS (
      SELECT floor(clat) c1lat, floor(clon) c1lon, country,
             sum(viirs_snpp) v, sum(modis_t+modis_a) mta, sum(modis_t) mt
      FROM m WHERE month >= DATE '{VIIRS_START}' AND year(month) BETWEEN {y0} AND {y1}
      GROUP BY ALL),
    g AS (SELECT sum(v)/sum(mta) r_ta, sum(v)/sum(mt) r_t FROM ov),
    c AS (SELECT country, (sum(v)+{A}*any_value(g.r_ta))/(sum(mta)+{A}) cr_ta,
                          (sum(v)+{A}*any_value(g.r_t))/(sum(mt)+{A}) cr_t
          FROM ov, g GROUP BY country),
    cell AS (SELECT c1lat, c1lon, arg_max(country, mta) country, sum(v) v, sum(mta) mta, sum(mt) mt
             FROM ov GROUP BY 1,2)
    SELECT cell.c1lat, cell.c1lon, cell.country, cell.v, cell.mta, cell.mt,
           (cell.v + {A}*coalesce(c.cr_ta, g.r_ta))/(cell.mta + {A}) r_ta,
           (cell.v + {A}*coalesce(c.cr_t , g.r_t ))/(cell.mt  + {A}) r_t,
           g.r_ta g_ta, g.r_t g_t
    FROM cell LEFT JOIN c USING(country), g
    """)

# --- validation: fit 2012-2018, test 2019-2025 -------------------------------
fit("r_val", 2012, 2018)
val = con.execute(f"""
WITH p AS (
  SELECT m.month, coalesce(m.country,'?') country, m.viirs_snpp v,
         (m.modis_t+m.modis_a) * coalesce(r.r_ta, (SELECT any_value(g_ta) FROM r_val)) pred,
         (m.modis_t+m.modis_a) * (SELECT any_value(g_ta) FROM r_val) pred_global
  FROM m LEFT JOIN r_val r ON floor(m.clat)=r.c1lat AND floor(m.clon)=r.c1lon
  WHERE year(m.month) BETWEEN 2019 AND 2025),
cm AS (SELECT country, month, sum(v) v, sum(pred) p, sum(pred_global) pg FROM p GROUP BY ALL)
SELECT corr(v,p) r_country_month, corr(v,pg) r_country_month_globalratio,
       sum(abs(p-v))/sum(v) wape, sum(abs(pg-v))/sum(v) wape_globalratio,
       sum(p)/sum(v) bias, count(*) n
FROM cm
""").fetchdf().iloc[0].to_dict()
print("validation 2019-2025 (country x month):", val, flush=True)

# --- final fit on full overlap -----------------------------------------------
fit("r", 2012, 2025)

# --- S-NPP outage months -> NOAA-20 gap fill ---------------------------------
# Month flagged when global S-NPP/NOAA-20 ratio < 85% of the median ratio.
con.execute("""
CREATE OR REPLACE TABLE gm AS
SELECT month, sum(viirs_snpp)::DOUBLE / nullif(sum(viirs_n20),0) q FROM m GROUP BY month""")
con.execute("""
CREATE OR REPLACE TABLE outage AS
SELECT month, q FROM gm WHERE q < 0.85 * (SELECT median(q) FROM gm WHERE q IS NOT NULL)""")
print("S-NPP outage months:", con.execute("SELECT strftime(month,'%Y-%m'), round(q,2) FROM outage ORDER BY 1").fetchall(), flush=True)
# S-NPP per NOAA-20 ratio on 1deg cells (normal months), shrunk to global
con.execute(f"""
CREATE OR REPLACE TABLE rn AS
WITH ov AS (SELECT floor(clat) c1lat, floor(clon) c1lon, sum(viirs_snpp) s, sum(viirs_n20) n
            FROM m WHERE viirs_n20 IS NOT NULL AND month NOT IN (SELECT month FROM outage)
              AND month IN (SELECT month FROM gm WHERE q IS NOT NULL) GROUP BY ALL),
     g AS (SELECT sum(s)::DOUBLE/sum(n) gr FROM ov)
SELECT c1lat, c1lon, (s + {A}*g.gr)/(n + {A}) r_sn, g.gr FROM ov, g""")
# --- FRP (fire radiative power, MW) ratios, same scheme --------------------------
# pseudo-count = A detections worth of mean FRP
def fit_frp(table, y0, y1):
    con.execute(f"""
    CREATE OR REPLACE TABLE {table} AS
    WITH ov AS (
      SELECT floor(clat) c1lat, floor(clon) c1lon,
             sum(frp_viirs) fv, sum(frp_modis_t+frp_modis_a) fta, sum(frp_modis_t) ft,
             sum(modis_t+modis_a) mta, sum(modis_t) mt
      FROM m WHERE month >= DATE '{VIIRS_START}' AND year(month) BETWEEN {y0} AND {y1}
        AND month NOT IN (SELECT month FROM outage) GROUP BY ALL),
    g AS (SELECT sum(fv)/sum(fta) gf_ta, sum(fv)/sum(ft) gf_t,
                 sum(fta)/sum(mta) mean_ta, sum(ft)/sum(mt) mean_t FROM ov)
    SELECT c1lat, c1lon, (fv + {A}*mean_ta*gf_ta)/(fta + {A}*mean_ta) rf_ta,
                         (fv + {A}*mean_t*gf_t)/(ft + {A}*mean_t) rf_t, gf_ta, gf_t
    FROM ov, g""")

fit_frp("rf_val", 2012, 2018)
val_frp = con.execute(f"""
WITH p AS (
  SELECT coalesce(m.country,'?') country, m.month, m.frp_viirs v,
         (m.frp_modis_t+m.frp_modis_a) * coalesce(rf.rf_ta, (SELECT any_value(gf_ta) FROM rf_val)) pred
  FROM m LEFT JOIN rf_val rf ON floor(m.clat)=rf.c1lat AND floor(m.clon)=rf.c1lon
  WHERE year(m.month) BETWEEN 2019 AND 2025 AND m.month NOT IN (SELECT month FROM outage)),
cm AS (SELECT country, month, sum(v) v, sum(pred) p FROM p GROUP BY ALL)
SELECT corr(v,p) r_country_month, sum(abs(p-v))/sum(v) wape, sum(p)/sum(v) bias, count(*) n FROM cm
""").fetchdf().iloc[0].to_dict()
print("FRP validation 2019-2025:", val_frp, flush=True)
fit_frp("rf", 2012, 2025)
con.execute(f"""
CREATE OR REPLACE TABLE rfn AS
WITH ov AS (SELECT floor(clat) c1lat, floor(clon) c1lon, sum(frp_viirs) fs, sum(frp_n20) fn, sum(viirs_n20) n
            FROM m WHERE viirs_n20 > 0 AND month NOT IN (SELECT month FROM outage)
              AND month IN (SELECT month FROM gm WHERE q IS NOT NULL) GROUP BY ALL),
     g AS (SELECT sum(fs)/sum(fn) gr, sum(fn)/sum(n) mean_n FROM ov)
SELECT c1lat, c1lon, (fs + {A}*mean_n*gr)/(fn + {A}*mean_n) rf_sn, gr FROM ov, g""")

con.execute(f"""
CREATE OR REPLACE TABLE h AS
SELECT m.*, year(month) AS year, month(month) AS mon,
  CASE WHEN month IN (SELECT month FROM outage)
            THEN frp_n20 * coalesce(rfn.rf_sn, (SELECT any_value(gr) FROM rfn))
       WHEN month >= DATE '{VIIRS_START}' THEN frp_viirs
       WHEN month >= DATE '{AQUA_START}'  THEN (frp_modis_t+frp_modis_a) * coalesce(rf.rf_ta, gf.gf_ta)
       ELSE frp_modis_t * coalesce(rf.rf_t, gf.gf_t) END AS frp_total,
  CASE WHEN month IN (SELECT month FROM outage)
            THEN viirs_n20 * coalesce(rn.r_sn, (SELECT any_value(gr) FROM rn))
       WHEN month >= DATE '{VIIRS_START}' THEN viirs_snpp::DOUBLE
       WHEN month >= DATE '{AQUA_START}'  THEN (modis_t+modis_a) * coalesce(r.r_ta, g.g_ta)
       ELSE modis_t * coalesce(r.r_t, g.g_t) END AS hotspots,
  CASE WHEN month IN (SELECT month FROM outage) THEN 'NOAA20_scaled'
       WHEN month >= DATE '{VIIRS_START}' THEN 'VIIRS_SNPP'
       WHEN month >= DATE '{AQUA_START}'  THEN 'MODIS_TA_scaled' ELSE 'MODIS_T_scaled' END AS basis
FROM m LEFT JOIN r ON floor(m.clat)=r.c1lat AND floor(m.clon)=r.c1lon
       LEFT JOIN rn ON floor(m.clat)=rn.c1lat AND floor(m.clon)=rn.c1lon
       LEFT JOIN rf ON floor(m.clat)=rf.c1lat AND floor(m.clon)=rf.c1lon
       LEFT JOIN rfn ON floor(m.clat)=rfn.c1lat AND floor(m.clon)=rfn.c1lon,
     (SELECT any_value(g_ta) g_ta, any_value(g_t) g_t FROM r) g,
     (SELECT any_value(gf_ta) gf_ta, any_value(gf_t) gf_t FROM rf) gf
""")
con.execute(f"COPY (SELECT * FROM h ORDER BY month, clat, clon) TO '{o}/grid_monthly_025deg.parquet' (FORMAT parquet, COMPRESSION zstd)")
con.execute(f"COPY r TO '{o}/ratios_1deg.parquet' (FORMAT parquet)")
# per-point weights: summing `w_count` / `w_frp * frp` over raw points of a source reproduces
# the harmonized series (VIIRS S-NPP units) for any area.
con.execute(f"""
COPY (
  SELECT coalesce(r.c1lat, rf.c1lat, rn.c1lat) c1lat, coalesce(r.c1lon, rf.c1lon, rn.c1lon) c1lon,
         coalesce(r.r_ta, (SELECT any_value(g_ta) FROM r)) w_count_modis_ta,
         coalesce(r.r_t,  (SELECT any_value(g_t)  FROM r)) w_count_modis_terra_only,
         coalesce(rn.r_sn, (SELECT any_value(gr) FROM rn)) w_count_noaa20,
         coalesce(rf.rf_ta, (SELECT any_value(gf_ta) FROM rf)) w_frp_modis_ta,
         coalesce(rf.rf_t,  (SELECT any_value(gf_t)  FROM rf)) w_frp_modis_terra_only,
         coalesce(rfn.rf_sn, (SELECT any_value(gr) FROM rfn)) w_frp_noaa20
  FROM r FULL JOIN rf USING (c1lat, c1lon) FULL JOIN rn USING (c1lat, c1lon) FULL JOIN rfn USING (c1lat, c1lon)
) TO '{o}/harmonization_factors_1deg.csv' (HEADER)""")
con.execute(f"COPY (SELECT strftime(month, '%Y-%m') AS ym, q AS snpp_per_noaa20 FROM outage ORDER BY 1) TO '{o}/snpp_outage_months.csv' (HEADER)")
con.execute(f"""COPY (SELECT country, year, mon, sum(hotspots) hotspots, sum(frp_total) frp_mw,
                  sum(modis_t+modis_a) modis, sum(viirs_snpp) viirs_snpp, sum(viirs_n20) viirs_noaa20,
                  any_value(basis) basis
                  FROM h GROUP BY ALL ORDER BY country, year, mon)
              TO '{o}/country_monthly.csv' (HEADER)""")
con.execute(f"""COPY (SELECT year, mon, sum(hotspots) hotspots, sum(frp_total) frp_mw, sum(modis_t+modis_a) modis,
                  sum(viirs_snpp) viirs_snpp, sum(viirs_n20) viirs_noaa20, any_value(basis) basis
                  FROM h GROUP BY ALL ORDER BY year, mon)
              TO '{o}/global_monthly.csv' (HEADER)""")
g = con.execute("SELECT any_value(g_ta), any_value(g_t) FROM r").fetchone()
(OUT / "summary.json").write_text(json.dumps(
    {"global_ratio_viirs_per_modis_TA": g[0], "global_ratio_viirs_per_modis_T": g[1],
     "validation_2019_2025_fit_2012_2018": val, "frp_validation_2019_2025": val_frp, "shrinkage_A": A,
     "viirs_start": VIIRS_START, "aqua_start": AQUA_START}, indent=2, default=float))
print("done", g, flush=True)
