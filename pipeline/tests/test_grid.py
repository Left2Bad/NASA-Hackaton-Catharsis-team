"""Daily/monthly grid on a tiny synthetic points table."""

import datetime as dt

import duckdb

import grid

ROWS = [
    # lat, lon, date, satellite, source, conf_class, frp, type
    (10.01, 20.01, "2020-08-01", "Terra", "modis", "n", 5.0, 0),
    (10.02, 20.02, "2020-08-01", "Aqua", "modis", "h", 7.0, 0),
    (10.03, 20.03, "2020-08-01", "N", "viirs-snpp", "n", 1.5, 0),
    (10.04, 20.04, "2020-08-02", "N", "viirs-snpp", "h", 2.5, 0),
    (10.05, 20.05, "2020-08-02", "N20", "viirs-jpss1", "n", 3.0, 0),
    (10.06, 20.06, "2020-08-02", "N", "viirs-snpp", "l", 9.0, 0),  # low confidence -> dropped
    (10.07, 20.07, "2020-08-03", "N", "viirs-snpp", "h", 9.0, 2),  # static source -> dropped
    (-33.95, -70.05, "2020-09-15", "N", "viirs-snpp", "n", 4.0, 0),  # other cell, other month
]


def make_points(tmp_path):
    pts = tmp_path / "points"
    pts.mkdir()
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE p (lat FLOAT, lon FLOAT, acq_date DATE, satellite VARCHAR, source VARCHAR,"
        " conf_class VARCHAR, frp FLOAT, type TINYINT)"
    )
    con.executemany("INSERT INTO p VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ROWS)
    con.execute(f"COPY p TO '{(pts / 'mixed_2020.parquet').as_posix()}' (FORMAT parquet)")
    return pts


def test_daily_and_monthly_grid(tmp_path):
    pts = make_points(tmp_path)
    con = duckdb.connect()
    parts = tmp_path / "parts"
    grid.build_year(con, 2020, 0.1, points=pts, out_dir=parts)
    daily, monthly = grid.combine(con, (parts / "*.parquet").as_posix(), data=tmp_path)

    d = con.execute(f"SELECT * FROM read_parquet('{daily.as_posix()}')").fetchall()
    # iy = floor((10.0x + 90) / 0.1) = 1000, ix = floor((20.0x + 180) / 0.1) = 2000
    assert d[0][:3] == (560, 1099, dt.date(2020, 9, 15))  # sorted by iy first: southern cell comes first
    by_day = {r[2]: r for r in d if r[0] == 1000}
    assert set(by_day) == {dt.date(2020, 8, 1), dt.date(2020, 8, 2)}  # 08-03 had only a static source
    aug1, aug2 = by_day[dt.date(2020, 8, 1)], by_day[dt.date(2020, 8, 2)]
    assert aug1[1] == 2000 and aug1[3:7] == (1, 1, 1, 0)  # n_t, n_a, n_snpp, n_n20
    assert aug2[3:7] == (0, 0, 1, 1)  # the low-confidence S-NPP point is excluded
    assert abs(aug2[9] - 2.5) < 1e-6  # f_snpp

    m = con.execute(
        f"SELECT iy, ix, month, n_snpp, n_n20 FROM read_parquet('{monthly.as_posix()}') ORDER BY iy"
    ).fetchall()
    assert m == [(560, 1099, dt.date(2020, 9, 1), 1, 0), (1000, 2000, dt.date(2020, 8, 1), 2, 1)]


def test_available_years(tmp_path):
    for name in ("modis_2000.parquet", "viirs-snpp_2012.parquet", "modis_2012.parquet", "notes.txt"):
        (tmp_path / name).write_bytes(b"")
    assert grid.available_years(tmp_path) == [2000, 2012]
