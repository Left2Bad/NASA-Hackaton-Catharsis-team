"""pipeline/make_sample.py cuts a sample DATA_DIR that the API loads: same numbers inside the sample box, NO_DATA
outside it (instead of zero fire)."""

import importlib.util
import json

import duckdb
from conftest import REPO, box, make_data, settings_for
from fastapi.testclient import TestClient

from app.main import create_app

API = "/api/v1"
INSIDE = box(10.0, 20.0, 11.0, 21.0)  # cells (1100, 1900) and (1105, 1905) of the fixture
OUTSIDE = box(40.0, 30.0, 41.0, 31.0)  # the fixture cell (1300, 2300), left out of the sample


def _make_sample_module():
    spec = importlib.util.spec_from_file_location("make_sample", REPO / "pipeline" / "make_sample.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _points(data, year: int) -> None:
    (data / "points_serve").mkdir(exist_ok=True)
    duckdb.execute(f"""COPY (SELECT *, DATE '{year}-08-05' AS acq_date
                             FROM (VALUES (20.5::FLOAT, 10.5::FLOAT), (30.5::FLOAT, 40.5::FLOAT)) t(lat, lon))
                       TO '{(data / "points_serve" / f"viirs-snpp_{year}.parquet").as_posix()}'""")


def test_sample_is_loadable_and_limited_to_its_boxes(tmp_path):
    full = make_data(tmp_path / "full")
    _points(full, 2019)
    _points(full, 2024)
    (full / "gap_days.csv").write_text("date,sensor,ratio\n2024-08-05,n20,0.0\n", encoding="utf-8")
    out = tmp_path / "sample"
    ms = _make_sample_module()
    sample = ms.make_sample(full, out, [(9.5, 19.5, 11.5, 21.5)], margin=0.0, points_from=2021)

    assert sample["rows"]["grid_daily"] > 0
    assert (out / "gap_days.csv").exists() and (out / "validation" / "report.json").exists()
    assert not (out / "points_serve" / "viirs-snpp_2019.parquet").exists()  # before --points-from
    kept = duckdb.execute(f"SELECT lat, lon FROM '{(out / 'points_serve' / 'viirs-snpp_2024.parquet').as_posix()}'")
    assert kept.fetchall() == [(20.5, 10.5)]  # the point outside the box is dropped
    summary = json.loads((out / "harmonized" / "summary.json").read_text(encoding="utf-8"))
    assert summary["sample"]["cell_ranges"] == [[1095, 1114, 1895, 1914]]
    assert summary["global_coefficients"]["count_ta"] == 2.0  # the full-data keys are kept

    with (
        TestClient(create_app(settings_for(full))) as on_full,
        TestClient(create_app(settings_for(out))) as on_sample,
    ):
        for path in ("/health", "/meta", "/method/validation"):
            assert on_sample.get(API + path).status_code == 200, path
        body = {"geometry": INSIDE, "start_year": 2000}
        a, b = on_full.post(f"{API}/calendar", json=body).json(), on_sample.post(f"{API}/calendar", json=body).json()
        assert [m["value"] for m in a["months"]] == [m["value"] for m in b["months"]]
        assert sum(m["value"] for m in b["months"]) > 0
        r = on_sample.post(f"{API}/calendar", json={"geometry": OUTSIDE, "start_year": 2000})
        assert r.status_code == 404 and r.json()["error"]["code"] == "NO_DATA"
        assert "sample dataset" in r.json()["error"]["message"]
        # on the full data the same area is served
        assert on_full.post(f"{API}/calendar", json={"geometry": OUTSIDE, "start_year": 2000}).status_code == 200
