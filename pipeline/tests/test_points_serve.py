"""Lightweight server copy of the points on tiny synthetic files."""

import duckdb
import pytest

import points_serve

FULL = (
    "lat FLOAT, lon FLOAT, acq_date DATE, acq_time SMALLINT, satellite VARCHAR, sensor VARCHAR, source VARCHAR,"
    " conf_class VARCHAR, conf_raw VARCHAR, bright FLOAT, bright2 FLOAT, frp FLOAT, scan FLOAT, track FLOAT,"
    " daynight VARCHAR, type TINYINT, country VARCHAR"
)
MODIS = [  # unsorted on purpose
    (12.5, 30.0, "2010-08-02", 822, "Terra", "MODIS", "modis", "n", "55", 310.0, 290.0, 14.7, 1.04, 1.01, "D", 0, "X"),
    (10.0, 31.0, "2010-08-01", 2129, "Aqua", "MODIS", "modis", "h", "90", 330.0, 295.0, 4.8, 2.5, 1.5, "N", 2, "X"),
    (11.0, 32.0, "2010-08-01", 715, "Terra", "MODIS", "modis", "l", "20", 305.0, 288.0, None, 1.0, 1.0, "D", 0, None),
]
VIIRS = [  # current year: has the quality column
    (5.0, 1.0, "2026-10-30", 130, "N", "VIIRS", "viirs-snpp", "n", "n", 330.0, 290.0, 2.0, 0.39, 0.36, "N", 0, "Y", "SP"),
    (4.0, 1.0, "2026-11-10", 1330, "N", "VIIRS", "viirs-snpp", "h", "h", 340.0, 291.0, 3.0, 0.5, 0.46, "D", 0, "Y", "NRT"),
]  # fmt: skip


def write(con, path, schema, rows):
    con.execute(f"CREATE OR REPLACE TABLE t ({schema})")
    con.executemany(f"INSERT INTO t VALUES ({', '.join('?' * len(rows[0]))})", rows)
    con.execute(f"COPY t TO '{path.as_posix()}' (FORMAT parquet)")


@pytest.fixture
def points(tmp_path):
    src = tmp_path / "points"
    src.mkdir()
    con = duckdb.connect()
    write(con, src / "modis_2010.parquet", FULL, MODIS)
    write(con, src / "viirs-snpp_2026.parquet", FULL + ", quality VARCHAR", VIIRS)
    return src


def read(path):
    return duckdb.connect().execute(f"SELECT * FROM read_parquet('{path.as_posix()}')").df()


def test_archive_year(points, tmp_path):
    con = duckdb.connect()
    dst, n = points_serve.convert(con, points / "modis_2010.parquet", tmp_path / "serve")
    assert n == len(MODIS) and dst.name == "modis_2010.parquet"
    df = read(dst)
    assert list(df.columns) == [
        "lat", "lon", "acq_date", "acq_time", "satellite", "sensor", "source", "conf_class", "frp",
        "pixel_km2", "daynight", "type", "quality",
    ]  # fmt: skip
    assert df["acq_date"].astype(str).tolist() == ["2010-08-01", "2010-08-01", "2010-08-02"]
    assert df["lat"].tolist() == [10.0, 11.0, 12.5]  # sorted by acq_date, lat
    assert df["satellite"].tolist() == ["A", "T", "T"]
    assert df["pixel_km2"].tolist() == pytest.approx([3.75, 1.0, 1.05])
    assert set(df["quality"]) == {"SP"}  # yearly archives are standard processing
    assert df["frp"].isna().sum() == 1 and df["type"].tolist() == [2, 0, 0]
    assert points_serve.is_done(con, points / "modis_2010.parquet", tmp_path / "serve")


def test_current_year_keeps_quality(points, tmp_path):
    dst, n = points_serve.convert(duckdb.connect(), points / "viirs-snpp_2026.parquet", tmp_path / "serve")
    df = read(dst)
    assert n == 2 and df["quality"].tolist() == ["SP", "NRT"]
    assert df["satellite"].tolist() == ["N", "N"]
    assert df["pixel_km2"].tolist() == pytest.approx([0.14, 0.23])


def test_unknown_satellite_is_rejected(points, tmp_path):
    con = duckdb.connect()
    write(con, points / "modis_2011.parquet", FULL, [MODIS[0][:4] + ("Envisat",) + MODIS[0][5:]])
    with pytest.raises(RuntimeError, match="unknown satellite"):
        points_serve.convert(con, points / "modis_2011.parquet", tmp_path / "serve")
    assert not (tmp_path / "serve" / "modis_2011.parquet").exists()
