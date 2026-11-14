"""Exact numbers on data that end mid-month in the NOAA-20 period (R36). See n20_data.py for how they are built.

A month of a baseline year y is 8B with B = y - 2000 (25 years: 8, 16, ..., 200), so for every calendar month but
November: median 104, p10 27.2, p25 56, p75 152, p90 180.8, max 200, and the mid-rank percentile of year y is 4B - 2.
November is 12B (median 156); its days 1..14 are 8B again.
"""

import csv
import io

import pytest
from conftest import assert_schema, box, settings_for
from fastapi.testclient import TestClient
from n20_data import make_n20_data

from app.main import create_app

API = "/api/v1"
AREA = box(10.0, 20.0, 11.0, 21.0)
BASELINE = {"median": 104.0, "p10": 27.2, "p25": 56.0, "p75": 152.0, "p90": 180.8, "max": 200.0, "n_years": 25}


@pytest.fixture(scope="module")
def n20(tmp_path_factory):
    data = make_n20_data(tmp_path_factory.mktemp("n20"))
    with TestClient(create_app(settings_for(data))) as c:
        yield c


def post(client, path, **body):
    r = client.post(f"{API}/{path}", json={"geometry": AREA, **body})
    assert r.status_code == 200, r.text
    return r


@pytest.fixture(scope="module")
def calendar(n20):
    c = post(n20, "calendar", series="raw").json()
    assert_schema(c, "CalendarResponse")
    return {(m["year"], m["month"]): m for m in c["months"]} | {"_": c}


def test_meta(n20):
    m = n20.get(f"{API}/meta").json()
    assert_schema(m, "Meta")
    assert (m["last_date"], m["last_standard_date"]) == ("2026-11-14", "2026-09-30")
    assert [(s["id"], s["end"]) for s in m["sources"]][-2:] == [("VIIRS_SNPP", "2026-10-31"), ("VIIRS_N20", None)]


def test_calendar_summary(calendar):
    c = calendar["_"]
    assert c["data_through"] == "2026-11-14" and c["cells"] == 100
    assert c["baseline"] == {"start_year": 2001, "end_year": 2025}
    assert all({k: b[k] for k in BASELINE} == BASELINE for b in c["monthly_baseline"] if b["month"] != 11)
    assert c["monthly_baseline"][10]["median"] == 156.0 and c["monthly_baseline"][10]["max"] == 300.0
    years = {y["year"]: y for y in c["yearly"]}
    assert years[2010] == {"year": 2010, "total": 1000.0, "complete": True}  # (12 x 8 + 4) x 10
    assert years[2026] == {"year": 2026, "total": 2190.0, "complete": False}  # 10 x 208 + 110
    # yearly totals 100B over 2001..2025: slope 100 per year, mean 1300 -> 100 x 10 / 1300 = 76.9 % per decade
    assert c["summary"]["trend_pct_per_decade"] == 76.9
    assert c["summary"]["trend_line"] == {
        "start_year": 2001,
        "start_value": 100.0,
        "end_year": 2025,
        "end_value": 2500.0,
    }
    assert c["summary"]["peak_year"] == 2025 and c["summary"]["peak_month"] == 11
    assert [w["code"] for w in c["warnings"]] == ["PRELIMINARY_DATA"]


def test_partial_noaa20_month(calendar):
    m = calendar[(2026, 11)]
    assert m["source"] == "VIIRS_N20" and m["partial"] is True and m["preliminary"] is True
    assert m["value"] == 110.0  # 88 NOAA-20 detections x 1.25
    assert (m["low"], m["high"]) == (99.0, 121.0)  # bin 4 of VIIRS_N20: x0.9 .. x1.1
    assert (m["percentile"], m["category"], m["anomaly_pct"]) == (None, None, None)
    assert m["raw"]["viirs_n20"] == 88.0 and m["raw"]["modis"] == 156.0


def test_preliminary_follows_last_standard_date(calendar):
    assert calendar[(2026, 9)]["preliminary"] is False
    oct_ = calendar[(2026, 10)]
    assert oct_["preliminary"] is True and oct_["source"] == "VIIRS_SNPP" and oct_["value"] == 208.0
    assert oct_["low"] == oct_["high"] == 208.0  # the reference sensor has no interval


@pytest.mark.parametrize(
    ("year", "percentile", "category"),
    [
        (2006, 22.0, "below_normal"),
        (2007, 26.0, "normal"),
        (2019, 74.0, "normal"),
        (2020, 78.0, "above_normal"),
        (2023, 90.0, "above_normal"),
        (2024, 94.0, "high"),
        (2026, 100.0, "record"),  # 208 is above the baseline maximum 200 and 2026 is outside the baseline
        (2000, 0.0, "below_normal"),  # no fires yet in 2000 (B = 0)
    ],
)
def test_percentile_and_category_at_boundaries(calendar, year, percentile, category):
    m = calendar[(year, 3 if year != 2000 else 12)]
    assert (m["percentile"], m["category"]) == (percentile, category)


def test_values_anomaly_and_intervals_by_source(calendar):
    m = calendar[(2001, 3)]  # Terra only: 2 x 1 x 4
    assert (m["source"], m["value"], m["low"], m["high"]) == ("MODIS_T", 8.0, 4.8, 12.8)  # nearest bin 3: x0.6 .. x1.6
    m = calendar[(2010, 3)]  # Terra + Aqua: 2 x (10 + 10) x 2
    assert (m["source"], m["value"], m["low"], m["high"]) == ("MODIS_TA", 80.0, 40.0, 160.0)
    assert m["anomaly_pct"] == -23.1 and m["median"] == 104.0
    assert calendar[(2015, 3)]["anomaly_pct"] == 15.4  # 120 vs 104


def test_frp(n20):
    c = post(n20, "calendar", metric="frp", start_year=2010).json()
    months = {(m["year"], m["month"]): m for m in c["months"]}
    assert months[(2010, 3)]["value"] == 60.0  # 2 days x (2B + 2B) x 0.75
    assert months[(2015, 3)]["value"] == 180.0  # 2 days x 6B, S-NPP as is
    m = months[(2026, 11)]  # 1.5 x 88 x 1.1
    assert (m["value"], m["low"], m["high"]) == (145.2, 116.2, 174.2)


def test_current_same_days_baseline(n20):
    c = post(n20, "current").json()
    assert_schema(c, "CurrentResponse")
    assert (c["as_of"], c["year"], c["month"], c["days_elapsed"]) == ("2026-11-14", 2026, 11, 14)
    assert c["value"] == 110.0 and c["source"] == "VIIRS_N20" and c["preliminary"] is True
    assert c["baseline_same_days"] == {k: BASELINE[k] for k in ("median", "p25", "p75", "p90", "max", "n_years")}
    assert (c["anomaly_pct"], c["percentile"], c["category"]) == (5.8, 52.0, "normal")
    cum = {d["day"]: (d["value"], d["median"]) for d in c["cumulative"]}
    assert cum[2] == (0.0, 0.0) and cum[3] == (50.0, 52.0) and cum[10] == (100.0, 104.0) and cum[14] == (110.0, 104.0)
    assert [w["code"] for w in c["warnings"]] == ["PRELIMINARY_DATA"]


def test_current_frp(n20):
    c = post(n20, "current", metric="frp").json()
    assert c["value"] == 145.2


def test_daily(n20):
    d = post(n20, "daily", year=2026).json()
    assert_schema(d, "DailyResponse")
    days = {x["date"]: x for x in d["days"]}
    assert len(days) == 318 and d["days"][-1]["date"] == "2026-11-14"
    assert days["2026-11-03"]["value"] == 50.0 and days["2026-11-14"]["value"] == 10.0
    assert days["2026-10-03"]["value"] == 104.0 and days["2026-10-04"]["value"] == 0.0
    assert days["2026-09-30"]["preliminary"] is False and days["2026-10-01"]["preliminary"] is True
    f = post(n20, "daily", year=2026, metric="frp").json()
    assert {x["date"]: x["value"] for x in f["days"]}["2026-11-03"] == 66.0  # 1.5 x 40 x 1.1


def test_points(n20):
    fc = post(n20, "points", year=2026, month=11).json()
    assert_schema(fc, "PointsResponse")
    assert fc["total"] == 3 and fc["truncated"] is False
    p = [f["properties"] for f in fc["features"]]
    assert [(x["satellite"], x["harmonized_weight"], x["quality"]) for x in p] == [
        ("N", 0.0, "NRT"), ("N20", 1.25, "NRT"), ("N20", 1.25, "NRT"),
    ]  # fmt: skip
    assert [f["geometry"]["coordinates"] for f in fc["features"]][1:] == [[10.2, 20.2], [10.3, 20.3]]


def test_export_points_csv(n20):
    r = post(n20, "export/points.csv", start_date="2026-09-01", end_date="2026-12-31")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert [(x["acq_datetime"], x["satellite"], x["quality"], x["harmonized_weight"]) for x in rows] == [
        ("2026-09-30T12:00:00Z", "N", "SP", "1.0"),
        ("2026-09-30T12:30:00Z", "N20", "SP", "0.0"),
        ("2026-10-15T01:00:00Z", "N20", "NRT", "0.0"),
        ("2026-11-02T13:00:00Z", "N", "NRT", "0.0"),
        ("2026-11-03T01:00:00Z", "N20", "NRT", "1.25"),
        ("2026-11-03T01:00:00Z", "N20", "NRT", "1.25"),
    ]
    assert [x["lat"] for x in rows[-2:]] == ["20.2", "20.3"]  # same minute: ordered by latitude


def test_export_calendar_csv(n20):
    r = post(n20, "export/calendar.csv", start_year=2026)
    rows = {(x["year"], x["month"]): x for x in csv.DictReader(io.StringIO(r.text))}
    assert len(rows) == 11
    assert rows[("2026", "11")] | {} == {
        "year": "2026", "month": "11", "value": "110.0", "low": "99.0", "high": "121.0", "median": "156.0",
        "anomaly_pct": "", "percentile": "", "category": "", "source": "VIIRS_N20", "preliminary": "true",
        "partial": "true",
    }  # fmt: skip
    assert (rows[("2026", "3")]["category"], rows[("2026", "3")]["percentile"]) == ("record", "100.0")
