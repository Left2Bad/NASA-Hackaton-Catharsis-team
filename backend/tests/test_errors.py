"""Error responses: contract shape and CORS headers on every status, request limits, the served OpenAPI document.

R12/R50 (absurd years), R14 (AREA_SMALL text), R25 (/docs shows the contract), R27/R51 (500 with CORS),
R28/R55 (dev allowlist from .env.example), R47 (vertex and body limits).
"""

import pytest
from conftest import REPO, SPEC, assert_schema, box, make_data, settings_for
from fastapi.testclient import TestClient

from app import daily_service
from app.main import create_app

API = "/api/v1"
AREA = box(10.0, 20.0, 11.0, 21.0)


def env_example_origins() -> tuple[str, ...]:
    for line in (REPO / ".env.example").read_text(encoding="utf-8").splitlines():
        if line.startswith("CORS_ORIGINS="):
            return tuple(o.strip() for o in line.split("=", 1)[1].split(",") if o.strip())
    raise AssertionError("CORS_ORIGINS is missing in .env.example")


ORIGINS = env_example_origins()


@pytest.fixture(scope="module")
def cors_client(tmp_path_factory):
    data = make_data(tmp_path_factory.mktemp("cors"))
    settings = settings_for(data, cors_origins=ORIGINS)
    with TestClient(create_app(settings), raise_server_exceptions=False) as c:
        yield c


def check_error(r, status, code):
    assert r.status_code == status, r.text
    assert_schema(r.json(), "ErrorResponse")
    assert r.json()["error"]["code"] == code


def test_dev_allowlist_covers_vite_on_localhost_and_127(cors_client):
    assert {"http://localhost:5173", "http://127.0.0.1:5173"} <= set(ORIGINS)
    for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
        r = cors_client.options(f"{API}/calendar", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
        assert r.status_code == 200 and r.headers["access-control-allow-origin"] == origin


def test_internal_error_has_cors_and_contract_body(cors_client, monkeypatch):
    def boom(*_):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(daily_service, "daily", boom)
    r = cors_client.post(
        f"{API}/daily", json={"geometry": AREA, "year": 2020}, headers={"Origin": "http://localhost:5173"}
    )
    check_error(r, 500, "INTERNAL")
    assert r.json()["error"]["message"] == "Internal server error"  # no internals leak
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("calendar", {"geometry": AREA, "end_year": 10000}),
        ("calendar", {"geometry": AREA, "start_year": 2001, "end_year": 100000}),
        ("calendar", {"geometry": AREA, "end_year": 99999999999999999999999}),
        ("calendar", {"geometry": AREA, "baseline": {"start_year": 2001, "end_year": 10000}}),
        ("export/calendar.csv", {"geometry": AREA, "end_year": 10000}),
        ("current", {"geometry": AREA, "baseline": {"start_year": 2001, "end_year": 10000}}),
        ("daily", {"geometry": AREA, "year": 10000}),
        ("points", {"geometry": AREA, "year": 10000, "month": 1}),
    ],
)
def test_years_above_9999_are_bad_requests(cors_client, path, body):
    r = cors_client.post(f"{API}/{path}", json=body, headers={"Origin": "http://localhost:5173"})
    check_error(r, 400, "INVALID_REQUEST")
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_year_9999_is_still_answered(cors_client):
    r = cors_client.post(f"{API}/calendar", json={"geometry": AREA, "start_year": 2020, "end_year": 9999})
    assert r.status_code == 200 and r.json()["data_through"] == "2025-12-31"
    check_error(cors_client.post(f"{API}/daily", json={"geometry": AREA, "year": 9999}), 404, "NO_DATA")


def test_too_many_vertices(cors_client):
    import math

    n = 6000
    ring = [[10.5 + 0.4 * math.cos(2 * math.pi * k / n), 20.5 + 0.4 * math.sin(2 * math.pi * k / n)] for k in range(n)]
    ring.append(ring[0])
    r = cors_client.post(f"{API}/calendar", json={"geometry": {"type": "Polygon", "coordinates": [ring]}})
    check_error(r, 400, "INVALID_GEOMETRY")
    assert "vertices" in r.json()["error"]["message"]
    many = {"type": "MultiPolygon", "coordinates": [box(i, 0, i + 0.05, 0.05)["coordinates"] for i in range(101)]}
    check_error(cors_client.post(f"{API}/calendar", json={"geometry": many}), 400, "INVALID_GEOMETRY")


def test_body_size_limit(cors_client):
    big = b'{"geometry": {"type": "Polygon", "coordinates": [[' + b"[10.0, 20.0], " * 100_000 + b"[10.0, 20.0]]]}}"
    r = cors_client.post(
        f"{API}/calendar",
        content=big,
        headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"},
    )
    check_error(r, 400, "INVALID_REQUEST")
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_small_area_message_names_the_cells(cors_client):
    c = cors_client.post(f"{API}/calendar", json={"geometry": box(10.012, 20.012, 10.016, 20.016)}).json()
    w = next(w for w in c["warnings"] if w["code"] == "AREA_SMALL")
    assert c["cells"] == 1 and "1 whole 0.1° grid cell " in w["message"] and "km²" in w["message"]
    d = cors_client.post(f"{API}/current", json={"geometry": box(10.0, 20.0, 10.2, 20.2)}).json()
    w = next(w for w in d["warnings"] if w["code"] == "AREA_SMALL")
    assert "4 whole 0.1° grid cells" in w["message"]


def test_openapi_document_is_the_contract(cors_client):
    doc = cors_client.get(f"{API}/openapi.json").json()
    assert doc["paths"] == SPEC["paths"] and doc["components"] == SPEC["components"]
    assert doc["servers"] == [{"url": "/api/v1", "description": "This server"}]
    assert all("422" not in op["responses"] for ops in doc["paths"].values() for op in ops.values())
    assert cors_client.get(f"{API}/docs").status_code == 200
