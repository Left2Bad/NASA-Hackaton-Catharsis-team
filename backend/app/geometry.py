"""Area of interest: GeoJSON validation, geodesic area, and the list of 0.1-degree grid cells inside it.

Edges are straight lines in longitude/latitude (RFC 7946 and how the map draws them), and cells are selected
the same way, so the area is measured on the same shape: every edge is densified along lon/lat before the
geodesic area is computed. An edge longer than 180 degrees of longitude is ambiguous (the short way across the
antimeridian or the long way round the globe) and is rejected: such areas must be split at +-180 degrees.
"""

import math
from dataclasses import dataclass

import numpy as np
import shapely
from pyproj import Geod
from shapely.geometry import shape

from .errors import ApiError

STEP = 0.1  # grid step, degrees (pipeline/grid.py)
NY, NX = 1800, 3600  # grid rows (latitude) and columns (longitude)
DENSIFY_DEG = STEP  # edges are split into pieces of at most this length before the geodesic area
_GEOD = Geod(ellps="WGS84")


@dataclass(frozen=True)
class Area:
    geom: shapely.Geometry
    area_km2: float  # geodesic area of the lon/lat polygon (holes subtracted)
    iy: np.ndarray  # cell row index: floor((lat + 90) / STEP)
    ix: np.ndarray  # cell column index: floor((lon + 180) / STEP)
    bounds: tuple[float, float, float, float]  # west, south, east, north
    part_bounds: tuple[tuple[float, float, float, float], ...]  # the same for every polygon of a MultiPolygon

    @property
    def cells(self) -> int:
        return int(self.iy.size)

    @property
    def cells_km2(self) -> float:
        """Area of the selected whole cells: the territory the values are actually summed over."""
        return cells_area_km2(self.iy)

    @property
    def is_box(self) -> bool:
        """A single lon/lat rectangle: the bounding-box filter alone is the exact test."""
        return self.geom.equals(shapely.box(*self.bounds))

    def cell_ranges(self) -> list[tuple[int, int, int, int]]:
        """Per polygon part: iy0, iy1, ix0, ix1 of the selected cells (for SQL range filters)."""
        out = []
        for west, south, east, north in self.part_bounds:
            iy0, iy1 = _index(south + 90, NY), _index(north + 90, NY)
            ix0, ix1 = _index(west + 180, NX), _index(east + 180, NX)
            out.append((iy0, iy1, ix0, ix1))
        return _merge(out)  # every selected cell (centre or outline) lies in its part's box

    def cell_scan_sql(self, source: str, where: str, iy: str = "iy", ix: str = "ix") -> str:
        """Rows of `source` inside the parts' cell ranges, as a UNION ALL of one range scan per part.

        A single OR of ranges is not pushed down to the Parquet reader, so far-apart parts scanned every row
        group between them; one scan per range lets DuckDB skip row groups for each. Later ranges exclude the
        earlier ones, so no row is returned twice.
        """
        ranges = [f"({iy} BETWEEN {a} AND {b} AND {ix} BETWEEN {c} AND {d})" for a, b, c, d in self.cell_ranges()]
        return _union(source, where, ranges)

    def point_scan_sql(self, source: str, where: str, lat: str = "lat", lon: str = "lon") -> str:
        """Points of `source` inside the parts' bounding boxes (UNION ALL of one scan per part, as above).

        A rectangle uses half-open bounds (west <= lon < east, south <= lat < north, closed at 180 and 90) like the
        grid's floor() rule, so a point on a shared edge belongs to one area only and matches /calendar.
        """
        if self.is_box:
            w, s, e, n = self.bounds
            hi_lat = "<=" if n >= 90 else "<"
            hi_lon = "<=" if e >= 180 else "<"
            ranges = [f"({lat} >= {s} AND {lat} {hi_lat} {n} AND {lon} >= {w} AND {lon} {hi_lon} {e})"]
        else:
            ranges = [f"({lat} BETWEEN {s} AND {n} AND {lon} BETWEEN {w} AND {e})" for w, s, e, n in self.part_bounds]
        return _union(source, where, ranges)


def _union(source: str, where: str, ranges: list[str]) -> str:
    scans = []
    for i, r in enumerate(ranges):
        exclude = "".join(f" AND NOT {q}" for q in ranges[:i])
        scans.append(f"SELECT * FROM {source} WHERE {r}{exclude} AND {where}")
    return "(" + " UNION ALL ".join(scans) + ")"


def _index(offset: float, n: int) -> int:
    return min(max(int(math.floor(offset / STEP)), 0), n - 1)


def _merge(ranges: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """Drop ranges contained in another one (keeps the SQL short for MultiPolygons with nested boxes)."""
    out = []
    for r in sorted(set(ranges)):
        if not any(o[0] <= r[0] and r[1] <= o[1] and o[2] <= r[2] and r[3] <= o[3] for o in out):
            out.append(r)
    return out


def _check_rings(geojson: dict) -> None:
    polys = [geojson["coordinates"]] if geojson["type"] == "Polygon" else geojson["coordinates"]
    for poly in polys:
        for ring in poly:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ApiError("INVALID_GEOMETRY", "The polygon ring must be closed and have at least 4 points.")
            for pt in ring:
                if len(pt) != 2 or not (-180 <= pt[0] <= 180 and -90 <= pt[1] <= 90):
                    raise ApiError(
                        "INVALID_GEOMETRY", "Coordinates must be in [longitude, latitude] order, in degrees."
                    )
            for a, b in zip(ring, ring[1:], strict=False):
                if abs(b[0] - a[0]) > 180:
                    raise ApiError(
                        "INVALID_GEOMETRY",
                        "An edge spans more than 180° of longitude. Areas that cross the antimeridian must be "
                        "split at ±180° into a MultiPolygon; wider areas must have shorter edges.",
                    )


def ring_area_km2(coords) -> float:
    """Unsigned geodesic area of one ring whose edges follow lon/lat straight lines."""
    ring = shapely.segmentize(shapely.LinearRing(coords), DENSIFY_DEG)
    xy = np.asarray(ring.coords)
    area, _ = _GEOD.polygon_area_perimeter(xy[:, 0], xy[:, 1])
    return abs(area) / 1e6


def polygon_area_km2(geom: shapely.Geometry) -> float:
    """Exterior minus holes, each taken unsigned, so ring orientation does not matter."""
    parts = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    return sum(ring_area_km2(p.exterior.coords) - sum(ring_area_km2(h.coords) for h in p.interiors) for p in parts)


def cells_area_km2(iy: np.ndarray) -> float:
    """Geodesic area of whole 0.1-degree cells given their row indices (one cell per row is measured)."""
    rows, n = np.unique(np.asarray(iy, dtype=np.int64), return_counts=True)
    total = 0.0
    for row, k in zip(rows.tolist(), n.tolist(), strict=True):
        s, t = row * STEP - 90, (row + 1) * STEP - 90
        a, _ = _GEOD.polygon_area_perimeter([0, STEP, STEP, 0], [s, s, t, t])
        total += abs(a) / 1e6 * k
    return total


def parse(geojson: dict, max_area_km2: float) -> Area:
    if not isinstance(geojson, dict) or geojson.get("type") not in ("Polygon", "MultiPolygon"):
        raise ApiError("INVALID_GEOMETRY", "The area must be a GeoJSON Polygon or MultiPolygon.")
    try:
        _check_rings(geojson)
        geom = shape(geojson)
    except ApiError:
        raise
    except Exception as exc:  # malformed nesting, non-numeric coordinates
        raise ApiError("INVALID_GEOMETRY", "Could not parse the GeoJSON geometry.") from exc
    if geom.is_empty or not geom.is_valid:
        reason = shapely.is_valid_reason(geom)
        raise ApiError("INVALID_GEOMETRY", f"Invalid geometry: {reason}.")

    area_km2 = polygon_area_km2(geom)
    if area_km2 > max_area_km2:
        raise ApiError("AREA_TOO_LARGE", f"The area is larger than {max_area_km2:,.0f} km². Reduce the area.")
    parts = tuple(geom.geoms) if geom.geom_type == "MultiPolygon" else (geom,)
    iy, ix = cells_inside(geom)
    return Area(
        geom=geom,
        area_km2=area_km2,
        iy=iy,
        ix=ix,
        bounds=tuple(geom.bounds),
        part_bounds=tuple(tuple(p.bounds) for p in parts),
    )


def _centre_cells(part: shapely.Geometry) -> tuple[np.ndarray, np.ndarray]:
    """Cells of one polygon whose centre lies strictly inside it, row by row (scanline).

    Each cell row is intersected with the polygon once, so the cost grows with the number of rows, not with
    the size of the bounding box.
    """
    west, south, east, north = part.bounds
    iy0 = max(int(math.floor((south + 90) / STEP - 0.5)) + 1, 0)
    iy1 = min(int(math.ceil((north + 90) / STEP - 0.5)) - 1, NY - 1)
    if iy1 < iy0:
        return np.empty(0, np.int64), np.empty(0, np.int64)
    rows = np.arange(iy0, iy1 + 1)
    lat = (rows + 0.5) * STEP - 90
    lines = shapely.linestrings(
        np.stack([np.full(rows.size, west - 1.0), lat, np.full(rows.size, east + 1.0), lat], axis=1).reshape(-1, 2, 2)
    )
    shapely.prepare(part)
    pieces, idx = shapely.get_parts(shapely.intersection(lines, part), return_index=True)
    out_y, out_x = [], []
    keep = shapely.get_type_id(pieces) == 1  # LineString; points are tangent vertices
    for piece, row in zip(pieces[keep], rows[idx[keep]], strict=True):
        x0, _, x1, _ = piece.bounds
        a = int(math.floor((x0 + 180) / STEP - 0.5)) + 1  # first centre strictly east of x0
        b = int(math.ceil((x1 + 180) / STEP - 0.5)) - 1  # last centre strictly west of x1
        a, b = max(a, 0), min(b, NX - 1)
        if b >= a:
            out_x.append(np.arange(a, b + 1))
            out_y.append(np.full(b - a + 1, row))
    if not out_x:
        return np.empty(0, np.int64), np.empty(0, np.int64)
    return np.concatenate(out_y), np.concatenate(out_x)


def _touched_cells(geom: shapely.Geometry) -> tuple[np.ndarray, np.ndarray]:
    """Cells that overlap the area (for areas too thin to contain any cell centre).

    Candidates are the cells the outline passes through; a cell that only touches the area along a grid line
    is dropped, so a sliver drawn exactly on a parallel does not pull in the row on the other side.
    """
    xy = shapely.get_coordinates(shapely.segmentize(geom.boundary, STEP / 4))
    iy = np.clip(np.floor((xy[:, 1] + 90) / STEP).astype(np.int64), 0, NY - 1)
    ix = np.clip(np.floor((xy[:, 0] + 180) / STEP).astype(np.int64), 0, NX - 1)
    key = np.unique(iy * NX + ix)
    iy, ix = key // NX, key % NX
    cells = shapely.box(ix * STEP - 180, iy * STEP - 90, (ix + 1) * STEP - 180, (iy + 1) * STEP - 90)
    keep = shapely.area(shapely.intersection(cells, geom)) > 0
    return (iy[keep], ix[keep]) if keep.any() else (iy, ix)


def cells_inside(geom: shapely.Geometry) -> tuple[np.ndarray, np.ndarray]:
    """Cells whose centre lies inside the geometry; areas without any centre get the cells their outline crosses."""
    parts = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    found = [_centre_cells(p) for p in parts]
    iy = np.concatenate([f[0] for f in found])
    ix = np.concatenate([f[1] for f in found])
    if iy.size == 0:
        iy, ix = _touched_cells(geom)
    key = np.unique(iy * NX + ix)  # parts may share a boundary
    return (key // NX).astype(np.int16), (key % NX).astype(np.int16)
