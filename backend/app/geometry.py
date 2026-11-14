"""Area of interest: GeoJSON validation, geodesic area, and the list of 0.1-degree grid cells inside it."""

from dataclasses import dataclass

import numpy as np
import shapely
from pyproj import Geod
from shapely.geometry import shape

from .errors import ApiError

STEP = 0.1  # grid step, degrees (pipeline/grid.py)
_GEOD = Geod(ellps="WGS84")


@dataclass(frozen=True)
class Area:
    geom: shapely.Geometry
    area_km2: float
    iy: np.ndarray  # cell row index: floor((lat + 90) / STEP)
    ix: np.ndarray  # cell column index: floor((lon + 180) / STEP)
    bounds: tuple[float, float, float, float]  # west, south, east, north

    @property
    def cells(self) -> int:
        return int(self.iy.size)


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

    parts = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    area_km2 = sum(abs(_GEOD.geometry_area_perimeter(p)[0]) for p in parts) / 1e6  # sign depends on ring orientation
    if area_km2 > max_area_km2:
        raise ApiError("AREA_TOO_LARGE", f"The area is larger than {max_area_km2:,.0f} km². Reduce the area.")
    west, south, east, north = geom.bounds
    iy, ix = cells_inside(geom)
    return Area(geom=geom, area_km2=area_km2, iy=iy, ix=ix, bounds=(west, south, east, north))


def cells_inside(geom: shapely.Geometry) -> tuple[np.ndarray, np.ndarray]:
    """Cells whose centre lies inside the geometry; tiny areas get the cell under the centroid."""
    west, south, east, north = geom.bounds
    iy0, iy1 = int(np.floor((south + 90) / STEP)), int(np.floor((north + 90) / STEP))
    ix0, ix1 = int(np.floor((west + 180) / STEP)), int(np.floor((east + 180) / STEP))
    iy_r = np.arange(iy0, min(iy1, 1799) + 1)
    ix_r = np.arange(ix0, min(ix1, 3599) + 1)
    gy, gx = np.meshgrid(iy_r, ix_r, indexing="ij")
    lat = (gy + 0.5) * STEP - 90
    lon = (gx + 0.5) * STEP - 180
    inside = shapely.contains_xy(geom, lon.ravel(), lat.ravel())
    iy, ix = gy.ravel()[inside], gx.ravel()[inside]
    if iy.size == 0:
        c = geom.centroid
        iy = np.array([int(np.floor((c.y + 90) / STEP))])
        ix = np.array([int(np.floor((c.x + 180) / STEP))])
    return iy.astype(np.int16), ix.astype(np.int16)
