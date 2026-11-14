"""Every response is checked against contract/openapi.yaml; numbers are checked on the synthetic data."""

import csv
import io

import pytest
from conftest import assert_schema, box

API = "/api/v1"
AREA = box(10.0, 20.0, 11.0, 21.0)  # contains cells (1100, 1900) and (1105, 1905)


def test_health(client):
    r = client.get(f"{API}/health")
    assert r.status_code == 200
    assert_schema(r.json(), "Health")


def test_meta(client):
    r = client.get(f"{API}/meta")
    assert r.status_code == 200
    m = r.json()
    assert_schema(m, "Meta")
    assert m["first_date"] == "2000-11-01" and m["last_date"] == "2025-12-31" and m["grid_deg"] == 0.1
    assert [s["id"] for s in m["sources"]] == ["MODIS_T", "MODIS_TA", "VIIRS_SNPP"]
    assert m["sources"][-1]["end"] is None
    assert len(m["presets"]) == 3


@pytest.mark.parametrize("series", ["harmonized", "raw"])
@pytest.mark.parametrize("metric", ["count", "frp"])
def test_calendar_matches_contract(client, series, metric):
    r = client.post(f"{API}/calendar", json={"geometry": AREA, "series": series, "metric": metric})
    assert r.status_code == 200, r.text
    c = r.json()
    assert_schema(c, "CalendarResponse")
    keys = [(m["year"], m["month"]) for m in c["months"]]
    assert keys[0] == (2000, 11) and keys[-1] == (2025, 12) and len(keys) == 302
    assert all(m["low"] <= m["value"] <= m["high"] for m in c["months"])
    assert [b["month"] for b in c["monthly_baseline"]] == list(range(1, 13))
    assert (series == "raw") == all("raw" in m for m in c["months"])


def month(c, y, m):
    return next(x for x in c["months"] if (x["year"], x["month"]) == (y, m))


def test_calendar_values_follow_lead_source(client):
    c = client.post(f"{API}/calendar", json={"geometry": AREA, "series": "raw"}).json()
    # 2001-03: Terra only, 2 fire days x (10 + 4) detections x Terra coefficient 4 (cell 1) / global 4 (cell 2)
    m = month(c, 2001, 3)
    assert m["source"] == "MODIS_T" and m["value"] == pytest.approx(2 * 14 * 4)
    assert m["raw"]["viirs_snpp"] is None and m["raw"]["viirs_n20"] is None
    # 2005-03: Terra + Aqua x 2
    m = month(c, 2005, 3)
    assert m["source"] == "MODIS_TA" and m["value"] == pytest.approx(2 * 28 * 2)
    assert m["low"] < m["value"] < m["high"]
    # 2015-03: S-NPP as is, no interval
    m = month(c, 2015, 3)
    assert m["source"] == "VIIRS_SNPP" and m["value"] == pytest.approx(2 * 4 * 28) and m["low"] == m["high"]
    # 2022-08: outage -> NOAA-20 x 1, flagged
    m = month(c, 2022, 8)
    assert m["source"] == "VIIRS_N20" and m["sensor_gap"] is True
    assert m["value"] == pytest.approx(2 * 4 * 28 * 3)
    assert any(w["code"] == "SENSOR_GAP" for w in c["warnings"])


def test_calendar_statistics(client):
    c = client.post(
        f"{API}/calendar", json={"geometry": AREA, "baseline": {"start_year": 2013, "end_year": 2021}}
    ).json()
    assert c["baseline"] == {"start_year": 2013, "end_year": 2021}
    july = c["monthly_baseline"][6]
    assert july["n_years"] == 9 and july["median"] > c["monthly_baseline"][0]["median"]
    assert c["summary"]["peak_month"] in (7, 8)
    years = {y["year"]: y for y in c["yearly"]}
    assert years[2000]["complete"] is False and years[2001]["complete"] is True
    assert c["summary"]["trend_line"]["start_year"] == 2001 and c["summary"]["trend_line"]["end_year"] == 2025
    m = month(c, 2025, 7)
    assert m["category"] in ("normal", "above_normal", "high", "below_normal") and m["percentile"] is not None


def test_area_without_fires_is_200_with_zeros(client):
    r = client.post(f"{API}/calendar", json={"geometry": box(-50, -50, -49, -49), "start_year": 2020})
    assert r.status_code == 200
    c = r.json()
    assert_schema(c, "CalendarResponse")
    assert (
        c["summary"]["total"] == 0
        and c["summary"]["peak_year"] is None
        and c["summary"]["trend_pct_per_decade"] is None
    )


def test_small_area_warning(client):
    c = client.post(f"{API}/calendar", json={"geometry": box(10.0, 20.0, 10.15, 20.15)}).json()
    assert c["cells"] < 9 and any(w["code"] == "AREA_SMALL" for w in c["warnings"])


@pytest.mark.parametrize(
    "body, status, code",
    [
        ({"geometry": box(-70, -20, -50, 0)}, 413, "AREA_TOO_LARGE"),
        (
            {"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}},
            400,
            "INVALID_GEOMETRY",
        ),
        ({"geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]}}, 400, "INVALID_GEOMETRY"),
        ({"geometry": {"type": "Point", "coordinates": [0, 0]}}, 400, "INVALID_GEOMETRY"),
        ({"geometry": AREA, "start_year": 2020, "end_year": 2010}, 400, "INVALID_REQUEST"),
        ({"geometry": AREA, "metric": "area"}, 400, "INVALID_REQUEST"),
        ({"geometry": AREA, "unknown": 1}, 400, "INVALID_REQUEST"),
        ({"geometry": AREA, "baseline": {"start_year": 1990, "end_year": 2000}}, 400, "INVALID_REQUEST"),
        ({"geometry": AREA, "start_year": 2030}, 404, "NO_DATA"),
    ],
)
def test_errors(client, body, status, code):
    r = client.post(f"{API}/calendar", json=body)
    assert r.status_code == status, r.text
    assert_schema(r.json(), "ErrorResponse")
    assert r.json()["error"]["code"] == code


def test_export_calendar_csv(client):
    r = client.post(f"{API}/export/calendar.csv", json={"geometry": AREA, "start_year": 2024})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(r.text)))
    with open(__import__("conftest").REPO / "contract" / "examples" / "export_calendar.csv", encoding="utf-8") as f:
        assert rows[0] == next(csv.reader(f))
    assert len(rows) == 1 + 24 and all(len(row) == len(rows[0]) for row in rows)
