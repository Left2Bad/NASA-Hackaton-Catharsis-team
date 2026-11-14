"""GET /method/validation serves data/validation/report.json as is; 404 NO_DATA while it is missing."""

import json

from conftest import REPO, assert_schema, make_data
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

API = "/api/v1"
EXAMPLE = REPO / "contract" / "examples" / "method_validation.response.json"


def test_method_validation(client):
    r = client.get(f"{API}/method/validation")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/json")
    assert_schema(r.json(), "ValidationResponse")
    assert r.json() == json.loads(EXAMPLE.read_text(encoding="utf-8"))


def test_method_validation_missing_then_cached(tmp_path):
    data = make_data(tmp_path)
    report = data / "validation" / "report.json"
    body = report.read_bytes()
    report.unlink()
    with TestClient(create_app(Settings(data_dir=data))) as c:
        r = c.get(f"{API}/method/validation")
        assert r.status_code == 404
        assert_schema(r.json(), "ErrorResponse")
        assert r.json()["error"]["code"] == "NO_DATA"
        # the report appears after a pipeline run; it is read once and kept in memory
        report.write_bytes(body)
        assert c.get(f"{API}/method/validation").status_code == 200
        report.unlink()
        assert c.get(f"{API}/method/validation").json() == json.loads(body)
