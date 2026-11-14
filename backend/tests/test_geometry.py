"""Area geometry: the area limit, the reported area and the summed cells describe one shape (R6, R7, R10, R15)."""

import time

import numpy as np
import pytest
import shapely
from conftest import assert_schema, box

from app import geometry
from app.errors import ApiError

API = "/api/v1"
LIMIT = 3_000_000


def ring(*pts):
    return [list(p) for p in pts] + [list(pts[0])]


def poly(*rings):
    return {"type": "Polygon", "coordinates": list(rings)}


def brute_cells(geom: shapely.Geometry) -> set[tuple[int, int]]:
    """Reference selection: every cell centre of the bounding box tested with contains_xy."""
    w, s, e, n = geom.bounds
    iy = np.arange(int(np.floor((s + 90) / 0.1)), int(np.ceil((n + 90) / 0.1)) + 1)
    ix = np.arange(int(np.floor((w + 180) / 0.1)), int(np.ceil((e + 180) / 0.1)) + 1)
    gx, gy = np.meshgrid(ix, iy)
    inside = shapely.contains_xy(geom, (gx + 0.5) * 0.1 - 180, (gy + 0.5) * 0.1 - 90)
    return set(zip(gy[inside].tolist(), gx[inside].tolist(), strict=True))


# R6: edges longer than 180 degrees of longitude are ambiguous and rejected


@pytest.mark.parametrize(
    "geojson",
    [
        box(-179.95, -60, 179.95, 75),  # "world box": the geodesic area sees a thin strip across the antimeridian
        box(170, -17.2, -170, -17.0),  # naive antimeridian box with normalised longitudes
        poly(ring((-170, 0), (170, 0), (170, 1), (-170, 1))),
    ],
)
def test_long_edge_is_rejected_quickly(geojson):
    t = time.perf_counter()
    with pytest.raises(ApiError) as e:
        geometry.parse(geojson, LIMIT)
    assert e.value.code == "INVALID_GEOMETRY" and "antimeridian" in e.value.message
    assert time.perf_counter() - t < 0.5


def test_long_edge_is_400_on_every_endpoint(client):
    world = box(-179.95, -60, 179.95, 75)
    for path, extra in [("calendar", {}), ("current", {}), ("daily", {"year": 2020}), ("export/calendar.csv", {})]:
        r = client.post(f"{API}/{path}", json={"geometry": world, **extra})
        assert r.status_code == 400, (path, r.text)
        assert_schema(r.json(), "ErrorResponse")
        assert r.json()["error"]["code"] == "INVALID_GEOMETRY"


def test_antimeridian_split_into_multipolygon_is_accepted():
    mp = {
        "type": "MultiPolygon",
        "coordinates": [[ring((170, -18), (180, -18), (180, -17), (170, -17))], [ring((-180, -18), (-170, -18), (-170, -17), (-180, -17))]],
    }  # fmt: skip
    a = geometry.parse(mp, LIMIT)
    assert a.cells == 2 * 100 * 10
    assert set(np.unique(a.ix).tolist()) == set(range(3500, 3600)) | set(range(0, 100))
    assert a.area_km2 == pytest.approx(a.cells_km2, rel=1e-3)


# R7: the reported (and limited) area is the area of the lon/lat polygon that is summed


@pytest.mark.parametrize(
    "bbox",
    [
        (-140, 55, -60, 62),  # Canada: the undensified geodesic quadrilateral was 20 % smaller
        (105, 60, 160, 72),  # Yakutia
        (-15, 10, 35, 15),  # Sahel
        (-62, -13, -52, -7),  # Amazon preset
    ],
)
def test_box_area_equals_area_of_selected_cells(bbox):
    a = geometry.parse(box(*bbox), 10 * LIMIT)
    w, s, e, n = bbox
    assert a.cells == round((e - w) / 0.1) * round((n - s) / 0.1)
    assert a.area_km2 == pytest.approx(a.cells_km2, rel=1e-3)


def test_wide_high_latitude_box_is_measured_between_parallels():
    canada = box(-140, 55, -60, 62)
    with pytest.raises(ApiError) as e:  # 3.63M km2: the old geodesic quadrilateral (2.89M) slipped under 3M
        geometry.parse(canada, LIMIT)
    assert e.value.code == "AREA_TOO_LARGE"
    a = geometry.parse(canada, 10 * LIMIT)
    assert 3.6e6 < a.area_km2 < 3.67e6


# R10: holes subtract whatever their winding


@pytest.mark.parametrize("ext_ccw", [True, False])
@pytest.mark.parametrize("hole_ccw", [True, False])
def test_hole_subtracts_for_any_winding(ext_ccw, hole_ccw):
    ext = [(-56, -11), (-54, -11), (-54, -9), (-56, -9)]
    hole = [(-55.5, -10.5), (-54.5, -10.5), (-54.5, -9.5), (-55.5, -9.5)]
    ext = ext if ext_ccw else ext[::-1]
    hole = hole if hole_ccw else hole[::-1]
    full = geometry.parse(box(-56, -11, -54, -9), LIMIT)
    inner = geometry.parse(box(-55.5, -10.5, -54.5, -9.5), LIMIT)
    a = geometry.parse(poly(ring(*ext), ring(*hole)), LIMIT)
    assert a.area_km2 == pytest.approx(full.area_km2 - inner.area_km2, rel=1e-9)
    assert a.cells == 300 and a.area_km2 == pytest.approx(a.cells_km2, rel=1e-3)


# R15 / R48: cells are selected per polygon part; cost follows the parts, not their joint bounding box


def test_far_apart_parts_are_cheap_and_filtered_per_part():
    mp = {
        "type": "MultiPolygon",
        "coordinates": [[ring((-179, -60), (-178, -60), (-178, -59), (-179, -59))], [ring((178, 70), (179, 70), (179, 71), (178, 71))]],
    }  # fmt: skip
    t = time.perf_counter()
    a = geometry.parse(mp, LIMIT)
    assert time.perf_counter() - t < 0.5
    assert a.cells == 200
    # each part's box, widened by the row/column its edge touches on the grid line
    assert a.cell_ranges() == [(300, 310, 10, 20), (1600, 1610, 3580, 3590)]
    sql = a.cell_scan_sql("g", "true")
    assert sql.count("SELECT * FROM g WHERE") == 2 and " OR " not in sql  # one prunable range scan per part
    assert "AND NOT (iy BETWEEN 300 AND 310 AND ix BETWEEN 10 AND 20)" in sql  # no row twice


def test_parts_with_overlapping_boxes_count_each_cell_once(client):
    # two triangles on either side of the box diagonal: valid MultiPolygon, the parts' boxes overlap almost fully
    a = [ring((10.0, 20.0), (10.95, 20.0), (10.0, 20.95))]
    b = [ring((11.0, 21.0), (10.05, 21.0), (11.0, 20.05))]
    sep = [client.post(f"{API}/calendar", json={"geometry": poly(*p)}).json() for p in (a, b)]
    r = client.post(f"{API}/calendar", json={"geometry": {"type": "MultiPolygon", "coordinates": [a, b]}})
    assert r.status_code == 200, r.text
    both = r.json()
    assert both["cells"] == sep[0]["cells"] + sep[1]["cells"]
    assert both["summary"]["total"] == pytest.approx(sep[0]["summary"]["total"] + sep[1]["summary"]["total"])
    assert both["summary"]["total"] > 0


def test_tiny_world_spanning_multipolygon_does_not_build_a_world_grid():
    mp = {
        "type": "MultiPolygon",
        "coordinates": [[ring((-179.9, -89.9), (-179.8, -89.9), (-179.8, -89.8), (-179.9, -89.8))], [ring((179.8, 89.8), (179.9, 89.8), (179.9, 89.9), (179.8, 89.9))]],
    }  # fmt: skip
    t = time.perf_counter()
    a = geometry.parse(mp, LIMIT)
    assert time.perf_counter() - t < 0.2
    assert a.cells == 2


def test_scanline_matches_bruteforce_on_random_polygons():
    rng = np.random.default_rng(7)
    for _ in range(40):
        cx, cy = rng.uniform(-170, 170), rng.uniform(-70, 70)
        k = int(rng.integers(3, 12))
        ang = np.sort(rng.uniform(0, 2 * np.pi, k))
        r = rng.uniform(0.05, 1.5, k)
        pts = list(zip((cx + r * np.cos(ang)).round(3), (cy + r * np.sin(ang)).round(3), strict=True))
        g = shapely.Polygon(pts)
        if not g.is_valid:
            continue
        a = geometry.parse(poly(ring(*pts)), LIMIT)
        got = set(zip(a.iy.tolist(), a.ix.tolist(), strict=True))
        ref = brute_cells(g)
        assert got == ref or (not ref and len(got) >= 1)


def test_sliver_without_cell_centres_gets_the_cells_it_crosses():
    a = geometry.parse(box(-58.0, -10.01, -53.0, -10.0), LIMIT)
    assert a.cells == 50  # every cell along the 5-degree sliver, not only the centroid cell
