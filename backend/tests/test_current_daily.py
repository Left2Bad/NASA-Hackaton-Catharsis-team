"""/current and /daily on the synthetic data (fire days: 5th and 20th of each month, plus 2025-12-31)."""

import pytest
from conftest import assert_schema, box

API = "/api/v1"
AREA = box(10.0, 20.0, 11.0, 21.0)
# per fire day in December 2025 (S-NPP leads): 4 x (Terra + Aqua) for cells with 10 and 4 detections
SNPP_DAY = 4 * 2 * 10 + 4 * 2 * 4


def test_current(client):
    r = client.post(f"{API}/current", json={"geometry": AREA})
    assert r.status_code == 200, r.text
    c = r.json()
    assert_schema(c, "CurrentResponse")
    assert (c["as_of"], c["year"], c["month"], c["days_elapsed"]) == ("2025-12-31", 2025, 12, 31)
    assert c["value"] == pytest.approx(3 * SNPP_DAY)  # 5th, 20th, 31st
    cum = {d["day"]: d["value"] for d in c["cumulative"]}
    assert len(cum) == 31 and cum[4] == 0 and cum[5] == SNPP_DAY and cum[20] == 2 * SNPP_DAY
    assert c["baseline_same_days"]["n_years"] == 24  # 2001-2024; the current year is not its own baseline
    # past Decembers had at most two fire days (S-NPP years: 2 x SNPP_DAY), so three days is a record
    assert c["baseline_same_days"]["max"] == pytest.approx(2 * SNPP_DAY)
    assert c["category"] == "record" and c["percentile"] == 100
    assert c["source"] == "VIIRS_SNPP" and c["preliminary"] is False


def test_current_frp_and_baseline(client):
    r = client.post(
        f"{API}/current", json={"geometry": AREA, "metric": "frp", "baseline": {"start_year": 2015, "end_year": 2020}}
    )
    assert r.status_code == 200, r.text
    assert_schema(r.json(), "CurrentResponse")
    assert r.json()["baseline_same_days"]["n_years"] == 6


def test_daily(client):
    r = client.post(f"{API}/daily", json={"geometry": AREA, "year": 2025})
    assert r.status_code == 200, r.text
    d = r.json()
    assert_schema(d, "DailyResponse")
    days = {x["date"]: x["value"] for x in d["days"]}
    assert len(days) == 365 and days["2025-01-01"] == 0
    assert days["2025-07-05"] == pytest.approx(3 * SNPP_DAY)  # summer season x3
    assert days["2025-12-31"] == pytest.approx(SNPP_DAY)


def test_daily_first_year_starts_with_data(client):
    d = client.post(f"{API}/daily", json={"geometry": AREA, "year": 2000}).json()
    assert_schema(d, "DailyResponse")
    assert d["days"][0]["date"] == "2000-11-01" and len(d["days"]) == 61


@pytest.mark.parametrize(
    "path, body, status, code",
    [
        ("daily", {"geometry": AREA, "year": 2030}, 404, "NO_DATA"),
        ("daily", {"geometry": AREA}, 400, "INVALID_REQUEST"),
        ("daily", {"geometry": box(-70, -20, -50, 0), "year": 2020}, 413, "AREA_TOO_LARGE"),
        ("current", {"geometry": AREA, "baseline": {"start_year": 1999, "end_year": 2005}}, 400, "INVALID_REQUEST"),
    ],
)
def test_errors(client, path, body, status, code):
    r = client.post(f"{API}/{path}", json=body)
    assert r.status_code == status, r.text
    assert_schema(r.json(), "ErrorResponse")
    assert r.json()["error"]["code"] == code
