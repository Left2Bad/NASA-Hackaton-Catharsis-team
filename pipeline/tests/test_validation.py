"""Validation report on a synthetic grid with known ratios, checked against the contract schema ValidationResponse."""

import datetime as dt
import json
from pathlib import Path

import duckdb
import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker

import validation

D = dt.date
SPEC = yaml.safe_load((Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml").read_text(encoding="utf-8"))

K_SNPP = 5  # S-NPP = 5 x (Terra + Aqua) everywhere
W_TA = 4.0  # but the MODIS coefficient says 4 -> harmonized = 0.8 x S-NPP
W_N20 = 1.25  # NOAA-20 = S-NPP / 1.25
OUTAGE = D(2024, 7, 1)  # S-NPP halved there


def assert_schema(payload, schema_name):
    """Same check as contract/tools/validate.py."""
    schema = {"$ref": f"#/components/schemas/{schema_name}", "components": SPEC["components"]}
    errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(payload))
    assert not errors, [f"{'/'.join(map(str, e.absolute_path))}: {e.message[:200]}" for e in errors[:5]]


def months(first, last):
    m = first
    while m <= last:
        yield m
        m = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def modis(month):
    return 10 + month.month  # Terra = Aqua, seasonal, the same every year


def make_data(data):
    """One fire cell in each preset and one outside them; 2009-2025."""
    cells = [(1430, 2460), (800, 1230), (1300, 580), (0, 0)]  # kz-steppe, amazon-south, california-north, outside
    rows = []
    for m in months(D(2009, 1, 1), D(2025, 12, 1)):
        n = modis(m)
        snpp = K_SNPP * 2 * n if m >= D(2012, 2, 1) else 0
        n20 = snpp / W_N20 if m >= D(2018, 4, 1) else 0
        if m == OUTAGE:
            snpp //= 2
        rows += [(iy, ix, m, n, n, snpp, n20) for iy, ix in cells]
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE g (iy SMALLINT, ix SMALLINT, month DATE, n_t INT, n_a INT, n_snpp INT, n_n20 INT,"
        " f_t FLOAT, f_a FLOAT, f_snpp FLOAT, f_n20 FLOAT)"
    )
    con.executemany("INSERT INTO g VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)", rows)
    con.execute(f"COPY g TO '{(data / 'grid_monthly.parquet').as_posix()}' (FORMAT parquet)")
    con.execute(f"""
    COPY (SELECT DISTINCT (iy // 10)::SMALLINT cy, (ix // 10)::SMALLINT cx, {W_TA}::FLOAT w_count_ta,
                 1::FLOAT w_count_t, {W_N20}::FLOAT w_count_n20, 1::FLOAT w_frp_ta, 1::FLOAT w_frp_t, 1::FLOAT w_frp_n20
          FROM g) TO '{(data / "coefficients.parquet").as_posix()}' (FORMAT parquet)""")
    (data / "outage_months.csv").write_text(f"month,snpp_per_n20\n{OUTAGE:%Y-%m},0.5\n", encoding="utf-8")


def test_metrics_known_numbers():
    m = validation.metrics([1, 2, 3, 4], [1, 3, 2, 4])
    assert m == {"pearson_r": 0.8, "bias_pct": 0.0, "mape_pct": 16.7, "n_months": 4}  # median of 0, 33.3, 50, 0
    m = validation.metrics([2, 4, 6, 1], [1, 2, 4, 0])
    assert m["bias_pct"] == pytest.approx(85.7)  # 13 / 7 - 1
    assert m["mape_pct"] == 100.0  # median of 100, 100, 50; the month with fact 0 is skipped
    assert m["n_months"] == 4


def test_cell_range_matches_cell_centres():
    assert validation.cell_range(51 + 90, 55 + 90) == (1410, 1449)
    assert validation.cell_range(38.5 + 90, 42 + 90) == (1285, 1319)
    assert validation.cell_range(-62 + 180, -52 + 180) == (1180, 1279)


@pytest.fixture(scope="module")
def report(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    make_data(data)
    validation.main(data=data)
    return json.loads((data / "validation" / "report.json").read_text(encoding="utf-8"))


def test_report_matches_contract(report):
    assert_schema(report, "ValidationResponse")
    assert report["calibration_period"] == {"start_year": 2012, "end_year": 2020}
    assert report["test_period"] == {"start_year": 2021, "end_year": 2025}
    assert [r["id"] for r in report["regions"]] == ["kz-steppe", "amazon-south", "california-north"]
    assert 3 <= len(report["limitations"]) <= 4


def test_region_series_and_metrics(report):
    for region in report["regions"]:
        series = region["series"]
        assert [(p["year"], p["month"]) for p in series] == [
            (m.year, m.month) for m in months(D(2021, 1, 1), D(2025, 12, 1))
        ]
        p = next(p for p in series if (p["year"], p["month"]) == (2023, 5))
        assert p == {"year": 2023, "month": 5, "modis_raw": 30.0, "viirs_raw": 150.0, "harmonized": 120.0}
        outage = next(p for p in series if (p["year"], p["month"]) == (2024, 7))
        assert outage["viirs_raw"] == 85.0  # kept in the series as is
        # the outage month is left out, so the forecast is exactly 0.8 x fact
        assert region["metrics"] == {"pearson_r": 1.0, "bias_pct": -20.0, "mape_pct": 20.0, "n_months": 59}


def test_seams(report):
    seams = {s["id"]: s for s in report["seams"]}
    # per cell and year: MODIS (Terra + Aqua) sum S, January M; 2012-01 is still MODIS, S-NPP from 2012-02
    s = sum(2 * modis(D(2001, m, 1)) for m in range(1, 13))
    jan = 2 * modis(D(2001, 1, 1))
    harmonized = (W_TA * jan + K_SNPP * (3 * s - jan)) / (W_TA * 3 * s)
    naive = (jan + K_SNPP * (3 * s - jan)) / (3 * s)
    assert seams["modis_to_snpp_2012"]["ratio_harmonized"] == pytest.approx(harmonized, abs=1e-3)
    assert seams["modis_to_snpp_2012"]["ratio_naive"] == pytest.approx(naive, abs=1e-3)
    # NOAA-20 x 1.25 is exactly S-NPP once the outage month is dropped
    assert seams["snpp_to_n20_2026"]["ratio_harmonized"] == 1.0
    assert seams["snpp_to_n20_2026"]["ratio_naive"] == 0.8
