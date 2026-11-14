"""Second synthetic DATA_DIR: the data end in the middle of a month in the NOAA-20 period (R36).

Built so every published number can be computed by hand:

- one fire cell (iy 1100, ix 1900) inside AREA = box(10, 20, 11, 21), fires on the 3rd and 10th of every month;
- in year y let B = y - 2000. Each fire day has n_t = B, n_a = B (Aqua from 2002-07-04), n_snpp = 4B (from
  2012-01-20, until S-NPP stops on 2026-11-02), n_n20 = 4B (from 2018-04-01); FRP f_t = f_a = 2B, f_snpp = 6B,
  f_n20 = 1.5 * n_n20;
- coefficients of the cell: count_t 4, count_ta 2, count_n20 1.25, frp_t 1.5, frp_ta 0.75, frp_n20 1.1, so the
  harmonized count of every fire day before November 2026 is 4B (Terra x 4 = (Terra + Aqua) x 2 = S-NPP),
  and a month is 8B;
- baseline Novembers also burn on the 20th (4B more, a month of 12B), after the 14th, so the same-days baseline of
  /current (8B) differs from the whole month;
- November 2026 (NOAA-20 leads): n_n20 = 40 on the 3rd and 10th and 8 on the 14th, the last day of the data;
  harmonized 1.25 x 88 = 110;
- points: the last standard-processing (SP) VIIRS day is 2026-09-30, later points are near-real-time (NRT).
"""

import datetime as dt
import json
from pathlib import Path

import duckdb

LAST = dt.date(2026, 11, 14)
LAST_SP = dt.date(2026, 9, 30)
CELL = (1100, 1900)
NOV_2026 = {3: 40, 10: 40, 14: 8}  # day -> NOAA-20 detections

POINT_SCHEMA = (
    "lat FLOAT, lon FLOAT, acq_date DATE, acq_time SMALLINT, satellite VARCHAR, sensor VARCHAR, source VARCHAR,"
    " conf_class VARCHAR, frp FLOAT, pixel_km2 FLOAT, daynight VARCHAR, type TINYINT, quality VARCHAR"
)


def _viirs(lat, lon, date, time, source, frp, quality):
    sat = "N" if source == "viirs-snpp" else "N20"
    return (lat, lon, date, time, sat, "VIIRS", source, "n", frp, 0.14, "N", 0, quality)


POINTS = {
    "viirs-snpp_2026": [
        _viirs(20.5, 10.5, "2026-09-30", 1200, "viirs-snpp", 2.0, "SP"),  # S-NPP leads: weight 1
        _viirs(20.5, 10.5, "2026-11-02", 1300, "viirs-snpp", 9.0, "NRT"),  # NOAA-20 leads: weight 0
    ],
    "viirs-jpss1_2026": [
        _viirs(20.5, 10.5, "2026-09-30", 1230, "viirs-jpss1", 2.5, "SP"),  # S-NPP leads: weight 0
        _viirs(20.4, 10.4, "2026-10-15", 100, "viirs-jpss1", 4.0, "NRT"),  # S-NPP leads: weight 0
        _viirs(20.3, 10.3, "2026-11-03", 100, "viirs-jpss1", 3.0, "NRT"),  # weight 1.25
        _viirs(20.2, 10.2, "2026-11-03", 100, "viirs-jpss1", 5.0, "NRT"),  # weight 1.25, same minute
        _viirs(30.0, 10.5, "2026-11-03", 100, "viirs-jpss1", 7.0, "NRT"),  # outside AREA
    ],
}


def _fire_days():
    m = dt.date(2000, 11, 1)
    while m <= LAST:
        for day in (3, 10, 14, 20):
            d = m.replace(day=day)
            if d > LAST or (day == 14 and (m.year, m.month) != (2026, 11)) or (day == 20 and m.month != 11):
                continue
            yield d
        m = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def grid_rows():
    rows = []
    for d in _fire_days():
        b = d.year - 2000
        n_t = b
        n_a = b if d >= dt.date(2002, 7, 4) else 0
        snpp = 4 * b if dt.date(2012, 1, 20) <= d <= dt.date(2026, 11, 2) else 0
        n20 = 4 * b if d >= dt.date(2018, 4, 1) else 0
        if (d.year, d.month) == (2026, 11):
            n20 = NOV_2026[d.day]
        f_t, f_a = 2.0 * n_t, 2.0 * n_a
        rows.append((*CELL, d, n_t, n_a, snpp, n20, f_t, f_a, 1.5 * snpp, 1.5 * n20))
    return rows


def make_n20_data(root: Path) -> Path:
    data = root / "data"
    (data / "harmonized").mkdir(parents=True)
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE g (iy SMALLINT, ix SMALLINT, date DATE, n_t INT, n_a INT, n_snpp INT, n_n20 INT,"
        " f_t FLOAT, f_a FLOAT, f_snpp FLOAT, f_n20 FLOAT)"
    )
    con.executemany("INSERT INTO g VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", grid_rows())
    con.execute(f"COPY (SELECT * FROM g ORDER BY iy, ix, date) TO '{(data / 'grid_daily.parquet').as_posix()}'")
    con.execute(f"""COPY (SELECT iy, ix, date_trunc('month', date)::DATE AS month,
                          sum(n_t)::INT n_t, sum(n_a)::INT n_a, sum(n_snpp)::INT n_snpp, sum(n_n20)::INT n_n20,
                          sum(f_t) f_t, sum(f_a) f_a, sum(f_snpp) f_snpp, sum(f_n20) f_n20
                   FROM g GROUP BY ALL ORDER BY iy, ix, month) TO '{(data / "grid_monthly.parquet").as_posix()}'""")
    con.execute(f"""COPY (SELECT * FROM (VALUES (110::SMALLINT, 190::SMALLINT, 2.0::FLOAT, 4.0::FLOAT, 1.25::FLOAT,
                                                0.75::FLOAT, 1.5::FLOAT, 1.1::FLOAT))
                          t(cy, cx, w_count_ta, w_count_t, w_count_n20, w_frp_ta, w_frp_t, w_frp_n20))
                   TO '{(data / "coefficients.parquet").as_posix()}'""")
    con.execute(f"""COPY (SELECT * FROM (VALUES ('MODIS_TA', 'count', 3, 0.5, 2.0, 100),
                                                ('MODIS_T', 'count', 3, 0.6, 1.6, 100),
                                                ('VIIRS_N20', 'count', 4, 0.9, 1.1, 100),
                                                ('VIIRS_N20', 'frp', 4, 0.8, 1.2, 100))
                          t(basis, metric, bin, q10, q90, n)) TO '{(data / "uncertainty.parquet").as_posix()}'""")
    (data / "outage_months.csv").write_text("month,snpp_per_n20\n", encoding="utf-8")
    summary = {
        "generated_at": "2026-11-14T12:00:00+00:00",
        "global_coefficients": {"count_ta": 2.0, "count_t": 4.0, "count_n20": 1.25, "frp_ta": 0.75, "frp_t": 1.5, "frp_n20": 1.1},
    }  # fmt: skip
    (data / "harmonized" / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    serve = data / "points_serve"
    serve.mkdir()
    for name, rows in POINTS.items():
        con.execute(f"CREATE OR REPLACE TABLE t ({POINT_SCHEMA})")
        con.executemany(f"INSERT INTO t VALUES ({', '.join('?' * 13)})", rows)
        con.execute(f"COPY (SELECT * FROM t ORDER BY acq_date, lat) TO '{(serve / name).as_posix()}.parquet'")
    return data
