"""Tiny synthetic DATA_DIR (CI has no real data) and a contract validator built from contract/openapi.yaml."""

import datetime as dt
import json
from pathlib import Path

import duckdb
import pytest
import yaml
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from app.main import create_app
from app.settings import Settings

REPO = Path(__file__).resolve().parents[2]
SPEC = yaml.safe_load((REPO / "contract" / "openapi.yaml").read_text(encoding="utf-8"))

# two fire cells inside the test box (lon 10..11, lat 20..21), one outside
CELLS = [(1100, 1900, 10), (1105, 1905, 4), (1300, 2300, 7)]  # iy, ix, base daily count
LAST = dt.date(2025, 12, 31)


def assert_schema(payload, schema_name: str) -> None:
    schema = {"$ref": f"#/components/schemas/{schema_name}", "components": SPEC["components"]}
    errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(payload))
    assert not errors, [f"{'/'.join(map(str, e.absolute_path))}: {e.message[:200]}" for e in errors[:5]]


def _days():
    d = dt.date(2000, 11, 1)
    while d <= LAST:
        yield d
        d += dt.timedelta(days=1)


def make_data(root: Path) -> Path:
    data = root / "data"
    (data / "harmonized").mkdir(parents=True)
    rows = []
    for d in _days():
        if d.day not in (5, 20) and d != LAST:  # two fire days per month keep the table small; LAST closes the series
            continue
        season = 3 if d.month in (7, 8) else 1
        for iy, ix, base in CELLS:
            n = base * season + (2 if d.year == 2010 else 0)
            n_t = n_a = n if d >= dt.date(2002, 8, 1) or True else 0
            n_a = n_a if d >= dt.date(2002, 7, 4) else 0
            snpp = 4 * (n_t + n_a) if d >= dt.date(2012, 1, 20) else 0
            n20 = snpp if d >= dt.date(2018, 4, 1) else 0
            if (d.year, d.month) == (2022, 8):
                snpp //= 3
            rows.append((iy, ix, d, n_t, n_a, snpp, n20, 2.0 * n_t, 2.0 * n_a, 1.5 * snpp, 1.5 * n20))
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
    con.execute(f"""COPY (SELECT * FROM (VALUES ('MODIS_TA', 'count', 0, 0.5, 2.0, 100), ('MODIS_TA', 'count', 4, 0.8, 1.25, 100),
                                                ('MODIS_T', 'count', 2, 0.6, 1.6, 100), ('VIIRS_N20', 'count', 2, 0.9, 1.1, 100))
                          t(basis, metric, bin, q10, q90, n)) TO '{(data / "uncertainty.parquet").as_posix()}'""")
    (data / "outage_months.csv").write_text("month,snpp_per_n20\n2022-08,0.33\n", encoding="utf-8")
    summary = {
        "generated_at": "2026-11-14T00:00:00+00:00",
        "global_coefficients": {
            "count_ta": 2.0,
            "count_t": 4.0,
            "count_n20": 1.0,
            "frp_ta": 0.75,
            "frp_t": 1.5,
            "frp_n20": 1.0,
        },  # fmt: skip
    }
    (data / "harmonized" / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    return data


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    data = make_data(tmp_path_factory.mktemp("api"))
    with TestClient(create_app(Settings(data_dir=data))) as c:
        yield c


def box(west, south, east, north):
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}
