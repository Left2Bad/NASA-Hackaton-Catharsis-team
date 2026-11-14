"""Data semantics written by the pipeline: completeness dates (summary.json) and sensor gap days (gap_days.csv).

One fire cell, every day of 2000-11..2002-12 and 2024-01..2026-11-14, with known counts:
Terra = Aqua = 5 a day, S-NPP = 40 (from 2012-01-20 to 2026-11-02), NOAA-20 = 40. Coefficients: Terra + Aqua x 2,
Terra only x 4, NOAA-20 x 1, so every source gives 20 (MODIS) or 40 (VIIRS) a day unless a sensor is missing.
Gaps: Terra 2001-06-16..30 (Terra-only era, nothing can replace it), Aqua 2002-08-01..07 (Terra fills in),
S-NPP 2025-03-10..12 (NOAA-20 fills in). The last day, 2026-11-14, was being fetched and is partial.
"""

import datetime as dt
import json

import duckdb
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

D = dt.date
GRID_LAST = D(2026, 11, 14)
TERRA_GAP = (D(2001, 6, 16), D(2001, 6, 30))
AQUA_GAP = (D(2002, 8, 1), D(2002, 8, 7))
SNPP_GAP = (D(2025, 3, 10), D(2025, 3, 12))
SNPP_LAST = D(2026, 11, 2)
GEOM = {"type": "Polygon", "coordinates": [[[10, 20], [11, 20], [11, 21], [10, 21], [10, 20]]]}


def days(first, last):
    d = first
    while d <= last:
        yield d
        d += dt.timedelta(days=1)


def inside(d, span):
    return span[0] <= d <= span[1]


def make_data(root, with_dates=True):
    data = root / "data"
    (data / "harmonized").mkdir(parents=True)
    rows = []
    for d in [*days(D(2000, 11, 1), D(2002, 12, 31)), *days(D(2024, 1, 1), GRID_LAST)]:
        n_t = 0 if inside(d, TERRA_GAP) else 5
        n_a = 0 if d < D(2002, 7, 4) or inside(d, AQUA_GAP) else 5
        snpp = 40 if D(2012, 1, 20) <= d <= SNPP_LAST and not inside(d, SNPP_GAP) else 0
        n20 = 40 if d >= D(2018, 4, 1) else 0
        if d == GRID_LAST:  # partial day
            n_t, n_a, n20 = 1, 1, 8
        rows.append((1100, 1900, d, n_t, n_a, snpp, n20, 2.0 * n_t, 2.0 * n_a, 1.5 * snpp, 1.5 * n20))
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE g (iy SMALLINT, ix SMALLINT, date DATE, n_t INT, n_a INT, n_snpp INT, n_n20 INT,"
        " f_t FLOAT, f_a FLOAT, f_snpp FLOAT, f_n20 FLOAT)"
    )
    con.executemany("INSERT INTO g VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    con.execute(f"COPY (SELECT * FROM g ORDER BY iy, ix, date) TO '{(data / 'grid_daily.parquet').as_posix()}'")
    con.execute(f"""COPY (SELECT iy, ix, date_trunc('month', date)::DATE AS month,
                          sum(n_t)::INT n_t, sum(n_a)::INT n_a, sum(n_snpp)::INT n_snpp, sum(n_n20)::INT n_n20,
                          sum(f_t) f_t, sum(f_a) f_a, sum(f_snpp) f_snpp, sum(f_n20) f_n20
                   FROM g GROUP BY ALL ORDER BY iy, ix, month) TO '{(data / "grid_monthly.parquet").as_posix()}'""")
    con.execute(f"""COPY (SELECT * FROM (VALUES (110::SMALLINT, 190::SMALLINT, 2.0::FLOAT, 4.0::FLOAT, 1.0::FLOAT,
                                                0.75::FLOAT, 1.5::FLOAT, 1.0::FLOAT))
                          t(cy, cx, w_count_ta, w_count_t, w_count_n20, w_frp_ta, w_frp_t, w_frp_n20))
                   TO '{(data / "coefficients.parquet").as_posix()}'""")
    (data / "outage_months.csv").write_text("month,snpp_per_n20\n", encoding="utf-8")
    gaps = [(d, "terra") for d in days(*TERRA_GAP)] + [(d, "aqua") for d in days(*AQUA_GAP)]
    gaps += [(d, "snpp") for d in days(*SNPP_GAP)]
    (data / "gap_days.csv").write_text(
        "date,sensor,ratio\n" + "".join(f"{d},{s},0.0\n" for d, s in gaps), encoding="utf-8"
    )
    summary = {
        "generated_at": "2026-11-14T12:00:00+00:00",
        "global_coefficients": {"count_ta": 2.0, "count_t": 4.0, "count_n20": 1.0,
                                "frp_ta": 0.75, "frp_t": 1.5, "frp_n20": 1.0},
    }  # fmt: skip
    if with_dates:
        summary |= {
            "last_date": str(GRID_LAST),
            "last_complete_date": "2026-11-13",
            "last_standard_date": "2026-07-31",
            "sensor_last_dates": {"viirs_snpp": str(SNPP_LAST)},
        }
    (data / "harmonized" / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    return data


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    with TestClient(create_app(Settings(data_dir=make_data(tmp_path_factory.mktemp("sem"))))) as c:
        yield c


def daily(client, year):
    r = client.post("/api/v1/daily", json={"geometry": GEOM, "year": year})
    assert r.status_code == 200, r.text
    return {D.fromisoformat(x["date"]): x["value"] for x in r.json()["days"]}


def calendar(client, **kw):
    r = client.post("/api/v1/calendar", json={"geometry": GEOM, **kw})
    assert r.status_code == 200, r.text
    body = r.json()
    return {(m["year"], m["month"]): m for m in body["months"]}, body


def test_dates_come_from_summary(client):
    meta = client.get("/api/v1/meta").json()
    assert meta["last_date"] == "2026-11-13"  # the partial fetch day is left out
    assert meta["last_standard_date"] == "2026-07-31"
    cur = client.post("/api/v1/current", json={"geometry": GEOM}).json()
    assert cur["as_of"] == "2026-11-13" and cur["days_elapsed"] == 13
    assert cur["value"] == 13 * 40  # NOAA-20 x 1 on 13 full days, no partial day
    assert max(daily(client, 2026)) == D(2026, 11, 13)


def test_snpp_gap_days_come_from_noaa20(client):
    by_day = daily(client, 2025)
    assert [by_day[d] for d in days(D(2025, 3, 9), D(2025, 3, 13))] == [40] * 5
    months, body = calendar(client, start_year=2025, end_year=2025)
    march = months[(2025, 3)]
    assert march["value"] == pytest.approx(sum(v for d, v in by_day.items() if d.month == 3))  # month = sum of days
    assert march["value"] == 31 * 40
    assert march["sensor_gap"] and march["source"] == "VIIRS_SNPP"
    assert not months[(2025, 4)]["sensor_gap"]
    assert any(w["code"] == "SENSOR_GAP" and "2025-03" in w["message"] for w in body["warnings"])


def test_aqua_gap_days_come_from_terra(client):
    by_day = daily(client, 2002)
    assert by_day[D(2002, 8, 3)] == 5 * 4  # Terra x Terra-only coefficient, not (5 + 0) x 2
    assert by_day[D(2002, 8, 8)] == 10 * 2
    months, _ = calendar(client, start_year=2002, end_year=2002)
    assert months[(2002, 8)]["value"] == 31 * 20 and months[(2002, 8)]["sensor_gap"]


def test_terra_gap_month_is_flagged_not_filled(client):
    months, body = calendar(client, start_year=2001, end_year=2001)
    june = months[(2001, 6)]
    assert june["sensor_gap"] and june["source"] == "MODIS_T"
    assert june["value"] == 15 * 20  # 15 days with Terra; nothing replaces the other 15
    assert not months[(2001, 5)]["sensor_gap"]
    assert any(w["code"] == "SENSOR_GAP" and "2001-06" in w["message"] for w in body["warnings"])


def test_raw_snpp_reported_for_its_last_month(client):
    months, _ = calendar(client, start_year=2026, end_year=2026, series="raw")
    assert months[(2026, 11)]["raw"]["viirs_snpp"] == 2 * 40  # 1 and 2 November
    assert months[(2026, 11)]["source"] == "VIIRS_N20"


def test_old_summary_falls_back_to_the_grid(tmp_path):
    data = make_data(tmp_path, with_dates=False)
    with TestClient(create_app(Settings(data_dir=data))) as c:
        meta = c.get("/api/v1/meta").json()
    assert meta["last_date"] == str(GRID_LAST)
    assert meta["last_standard_date"] == str(GRID_LAST)  # no points files: everything counts as standard
