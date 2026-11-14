"""POST /points and POST /export/points.csv on tiny synthetic points (data/points_serve layout)."""

import csv
import io

import duckdb
import pytest
from conftest import assert_schema, box, make_data
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

API = "/api/v1"
AREA = box(10.0, 20.0, 11.0, 21.0)  # one 1-degree coefficient cell: count_t 4, count_ta 2, count_n20 1
SCHEMA = (
    "lat FLOAT, lon FLOAT, acq_date DATE, acq_time SMALLINT, satellite VARCHAR, sensor VARCHAR, source VARCHAR,"
    " conf_class VARCHAR, frp FLOAT, pixel_km2 FLOAT, daynight VARCHAR, type TINYINT, quality VARCHAR"
)


def modis(lat, lon, date, time, sat, conf="n", frp=10.0, typ=0):
    return (lat, lon, date, time, sat, "MODIS", "modis", conf, frp, 1.0, "D", typ, "SP")


def viirs(lat, lon, date, time, source, conf="n", frp=1.0, quality="SP"):
    sat = "N" if source == "viirs-snpp" else "N20"
    return (lat, lon, date, time, sat, "VIIRS", source, conf, frp, 0.14, "N", 0, quality)


FILES = {
    "modis_2001": [modis(20.5, 10.5, "2001-03-05", 1030, "T")],  # Terra only: weight 4
    "modis_2010": [
        modis(20.2, 10.2, "2010-08-02", 822, "T", frp=14.7),  # Terra + Aqua: weight 2
        modis(20.3, 10.8, "2010-08-04", 715, "A", conf="h", frp=None),
        modis(20.4, 10.4, "2010-08-05", 900, "T", conf="l"),  # low confidence: weight 0
        modis(20.6, 10.6, "2010-08-06", 900, "T", typ=2),  # not a vegetation fire: weight 0
        modis(30.0, 10.5, "2010-08-07", 900, "T"),  # outside the area
        modis(20.5, 10.5, "2010-09-01", 900, "T"),  # next month
    ],
    "modis_2015": [modis(20.5, 10.5, "2015-03-05", 1000, "A")],  # S-NPP leads: MODIS weight 0
    "viirs-snpp_2015": [viirs(20.5, 10.5, "2015-03-05", 1100, "viirs-snpp")],
    "viirs-snpp_2021": [viirs(20.05 + i / 20, 10.5, "2021-08-10", 100 + i, "viirs-snpp", frp=i) for i in range(1, 11)],
    "viirs-snpp_2022": [viirs(20.5, 10.5, "2022-08-03", 100, "viirs-snpp")],  # S-NPP outage month: NOAA-20 leads
    "viirs-jpss1_2022": [viirs(20.5, 10.6, "2022-08-03", 150, "viirs-jpss1", quality="NRT")],
}


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    data = make_data(tmp_path_factory.mktemp("points"))
    serve = data / "points_serve"
    serve.mkdir()
    con = duckdb.connect()
    for name, rows in FILES.items():
        con.execute(f"CREATE OR REPLACE TABLE t ({SCHEMA})")
        con.executemany(f"INSERT INTO t VALUES ({', '.join('?' * 13)})", rows)
        con.execute(f"COPY (SELECT * FROM t ORDER BY acq_date, lat) TO '{(serve / name).as_posix()}.parquet'")
    settings = Settings(data_dir=data, max_points=5, max_export_rows=8)
    with TestClient(create_app(settings)) as c:
        yield c


def post_points(client, year, month, geometry=AREA):
    r = client.post(f"{API}/points", json={"geometry": geometry, "year": year, "month": month})
    assert r.status_code == 200, r.text
    assert_schema(r.json(), "PointsResponse")
    return r.json()


def props(fc):
    return [f["properties"] for f in fc["features"]]


def test_points_month_weights_and_fields(client):
    fc = post_points(client, 2010, 8)
    assert fc["type"] == "FeatureCollection" and fc["total"] == 4 and fc["truncated"] is False
    p = props(fc)
    assert [x["acq_datetime"] for x in p] == [
        "2010-08-02T08:22:00Z", "2010-08-04T07:15:00Z", "2010-08-05T09:00:00Z", "2010-08-06T09:00:00Z",
    ]  # fmt: skip
    assert [x["satellite"] for x in p] == ["T", "A", "T", "T"]
    assert [x["conf_class"] for x in p] == ["nominal", "high", "low", "nominal"]
    assert [x["harmonized_weight"] for x in p] == [2.0, 2.0, 0.0, 0.0]
    assert p[0]["frp"] == pytest.approx(14.7) and p[1]["frp"] is None
    assert fc["features"][0]["geometry"]["coordinates"] == pytest.approx([10.2, 20.2])
    assert {x["quality"] for x in p} == {"SP"}


@pytest.mark.parametrize(
    ("year", "month", "expected"),
    [
        (2001, 3, [("T", 4.0)]),  # Terra-only period
        (2015, 3, [("A", 0.0), ("N", 1.0)]),  # S-NPP is the reference
        (2022, 8, [("N", 0.0), ("N20", 1.0)]),  # S-NPP outage month
    ],
)
def test_weight_follows_lead_source(client, year, month, expected):
    p = props(post_points(client, year, month))
    assert [(x["satellite"], x["harmonized_weight"]) for x in p] == expected


def test_nrt_quality(client):
    p = props(post_points(client, 2022, 8))
    assert [x["quality"] for x in p] == ["SP", "NRT"]


def test_truncated_keeps_strongest(client):
    fc = post_points(client, 2021, 8)
    assert fc["total"] == 10 and fc["truncated"] is True and len(fc["features"]) == 5
    assert sorted(x["frp"] for x in props(fc)) == [6.0, 7.0, 8.0, 9.0, 10.0]


def test_polygon_is_exact(client):
    # triangle over the lower-left half of the box: the 2021-08 points lie on lon 10.5 at lat 20.1 .. 20.55
    tri = {"type": "Polygon", "coordinates": [[[10.0, 20.0], [11.0, 20.0], [10.0, 21.0], [10.0, 20.0]]]}
    fc = post_points(client, 2021, 8, tri)
    assert fc["total"] == 9  # lat 20.55 > 21 - 10.5 is outside
    fc = post_points(client, 2021, 8, box(40.0, 40.0, 41.0, 41.0))
    assert fc == {"type": "FeatureCollection", "features": [], "total": 0, "truncated": False}


def error(r, status, code):
    assert r.status_code == status, r.text
    assert_schema(r.json(), "ErrorResponse")
    assert r.json()["error"]["code"] == code


def test_points_errors(client):
    error(client.post(f"{API}/points", json={"geometry": AREA, "year": 2026, "month": 1}), 404, "NO_DATA")
    error(client.post(f"{API}/points", json={"geometry": AREA, "year": 2000, "month": 5}), 404, "NO_DATA")
    error(client.post(f"{API}/points", json={"geometry": AREA, "year": 2005, "month": 5}), 404, "NO_DATA")  # no file
    error(client.post(f"{API}/points", json={"geometry": AREA, "year": 2010, "month": 13}), 400, "INVALID_REQUEST")
    bad = {"type": "Polygon", "coordinates": [[[10, 20], [11, 21], [11, 20], [10, 21], [10, 20]]]}
    error(client.post(f"{API}/points", json={"geometry": bad, "year": 2010, "month": 8}), 400, "INVALID_GEOMETRY")
    huge = box(0.0, -10.0, 40.0, 30.0)
    error(client.post(f"{API}/points", json={"geometry": huge, "year": 2010, "month": 8}), 413, "AREA_TOO_LARGE")


def export(client, start, end, geometry=AREA):
    return client.post(f"{API}/export/points.csv", json={"geometry": geometry, "start_date": start, "end_date": end})


def test_export_csv(client):
    r = export(client, "2010-08-01", "2015-03-31")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"] == 'attachment; filename="hotspots.csv"'
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0] == [
        "lat", "lon", "acq_datetime", "sensor", "satellite", "conf_class", "frp", "daynight",
        "pixel_km2", "type", "quality", "harmonized_weight",
    ]  # fmt: skip
    body = [dict(zip(rows[0], x, strict=True)) for x in rows[1:]]
    assert len(body) == 7  # 4 in 2010-08, 1 in 2010-09, 2 in 2015-03
    assert body[0] == {
        "lat": "20.2", "lon": "10.2", "acq_datetime": "2010-08-02T08:22:00Z", "sensor": "MODIS", "satellite": "T",
        "conf_class": "nominal", "frp": "14.7", "daynight": "D", "pixel_km2": "1.0", "type": "0", "quality": "SP",
        "harmonized_weight": "2.0",
    }  # fmt: skip
    assert body[1]["frp"] == ""  # null FRP
    assert [x["harmonized_weight"] for x in body[-2:]] == ["0.0", "1.0"]


def test_export_errors(client):
    error(export(client, "2021-08-01", "2021-08-31"), 413, "EXPORT_TOO_LARGE")  # 10 points > limit 8
    tri = {"type": "Polygon", "coordinates": [[[10.0, 20.0], [10.9, 20.0], [10.0, 21.0], [10.0, 20.0]]]}
    r = export(client, "2021-08-01", "2021-08-31", tri)  # bounding box holds 10 points, the polygon 7 (lat < 20.44)
    assert r.status_code == 200, r.text
    assert len(r.text.strip().splitlines()) == 1 + 7
    error(export(client, "2010-08-31", "2010-08-01"), 400, "INVALID_REQUEST")
    error(export(client, "2026-01-01", "2026-02-01"), 404, "NO_DATA")
    error(
        client.post(f"{API}/export/points.csv", json={"geometry": AREA, "start_date": "2010-08-01"}),
        400,
        "INVALID_REQUEST",
    )
