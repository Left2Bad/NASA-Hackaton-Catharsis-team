"""Step 4: API CSV chunks (data/api_2026) -> data/parquet/<src>_2026.parquet, same schema as step 1.

API CSVs have no `country` column; SP chunks carry `type`, NRT chunks do not, so:
 * type: SP value when present; otherwise points falling in a ~0.01deg (~1 km) cell where the 2012-2025 archive had any
   type 2 (static/industrial) or 3 (offshore) detection get that type; volcano cells (type 1) too;
   everything else = 0.
 * country: taken from the 0.25deg grid cell's dominant country in the archive.
"""
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parents[1]
API = (ROOT / "data" / "raw" / "api_2026").as_posix()
PQ = (ROOT / "data" / "points").as_posix()
H = (ROOT / "data" / "harmonized").as_posix()

con = duckdb.connect()
con.execute(f"SET memory_limit='9GB'; SET preserve_insertion_order=false; SET temp_directory='{(ROOT / 'data' / '_tmp' / 'spill').as_posix()}'")
print("building static-source mask...", flush=True)
con.execute(f"""
CREATE TABLE mask AS
SELECT round(lat*100)::INT ky, round(lon*100)::INT kx, max(type) type
FROM read_parquet('{PQ}/*_20[12]*.parquet') WHERE type IN (1,2,3) AND year(acq_date) BETWEEN 2012 AND 2025
GROUP BY ALL""")
con.execute(f"""
CREATE TABLE cc AS SELECT clat, clon, arg_max(country, hotspots) country
FROM read_parquet('{H}/grid_monthly_025deg.parquet') GROUP BY ALL""")
print("mask cells:", con.execute("SELECT count(*) FROM mask").fetchone()[0], flush=True)

for src in ["modis", "viirs-snpp", "viirs-jpss1"]:
    files = list((ROOT / "data" / "raw" / "api_2026" / src).glob("*.csv"))
    if not files:
        print("no files for", src); continue
    is_modis = src == "modis"
    b1, b2 = ("brightness", "bright_t31") if is_modis else ("bright_ti4", "bright_ti5")
    conf = ("CASE WHEN TRY_CAST(confidence AS INT) < 30 THEN 'l' WHEN TRY_CAST(confidence AS INT) < 80 THEN 'n' ELSE 'h' END"
            if is_modis else "lower(substr(CAST(confidence AS VARCHAR),1,1))")
    out = f"{PQ}/{src}_2026.parquet"
    con.execute(f"""
    COPY (
      WITH p AS (
        SELECT DISTINCT * FROM read_csv('{API}/{src}/*.csv', all_varchar=true, header=true, union_by_name=true))
      SELECT CAST(latitude AS FLOAT) lat, CAST(longitude AS FLOAT) lon, CAST(acq_date AS DATE) acq_date,
             CAST(acq_time AS SMALLINT) acq_time,
             CASE CAST(satellite AS VARCHAR) WHEN 'T' THEN 'Terra' WHEN 'A' THEN 'Aqua' ELSE CAST(satellite AS VARCHAR) END satellite,
             '{'MODIS' if is_modis else 'VIIRS'}' sensor, '{src}' source,
             {conf} conf_class, CAST(confidence AS VARCHAR) conf_raw,
             CAST({b1} AS FLOAT) bright, CAST({b2} AS FLOAT) bright2, CAST(frp AS FLOAT) frp,
             CAST(scan AS FLOAT) scan, CAST(track AS FLOAT) track, CAST(daynight AS VARCHAR) daynight,
             CAST(coalesce(TRY_CAST(p.type AS TINYINT), mask.type, 0) AS TINYINT) type, cc.country
      FROM p
      LEFT JOIN mask ON mask.ky = round(CAST(latitude AS FLOAT)*100)::INT AND mask.kx = round(CAST(longitude AS FLOAT)*100)::INT
      LEFT JOIN cc ON cc.clat = floor(CAST(latitude AS FLOAT)*4)/4+0.125 AND cc.clon = floor(CAST(longitude AS FLOAT)*4)/4+0.125
      ORDER BY acq_date
    ) TO '{out}' (FORMAT parquet, COMPRESSION zstd)""")
    print(src, con.execute(f"SELECT count(*), min(acq_date), max(acq_date), count(*) FILTER (WHERE type<>0) FROM read_parquet('{out}')").fetchone(), flush=True)
