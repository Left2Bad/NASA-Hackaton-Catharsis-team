import type { Geometry } from '../api/types';
import { boundsOf, normalizeRing, outerRings, type Bounds, type LonLat } from './geometry';

// Building areas from numbers (bounds, or a point with a radius) and measuring them.
// All math is on a sphere, which is accurate to a fraction of a percent at these sizes.

const EARTH_RADIUS_KM = 6371.0088;
/** Length of one degree of latitude, km. */
const KM_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * Area of a geometry on the sphere, in km².
 * Uses the formula of Chamberlain and Duquette (2007) for polygons on a sphere.
 */
export function areaKm2(geometry: Geometry): number {
  let total = 0;
  for (const ring of outerRings(geometry)) {
    let sum = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [lon1, lat1] = ring[index];
      const [lon2, lat2] = ring[index + 1];
      sum += toRadians(lon2 - lon1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
    }
    total += (Math.abs(sum) * EARTH_RADIUS_KM ** 2) / 2;
  }
  return total;
}

/**
 * Roughly how many grid cells of `gridDeg` degrees fall inside the geometry.
 * The backend counts cells exactly; this estimate is for a check before the request.
 */
export function estimateCells(geometry: Geometry, gridDeg: number): number {
  const { south, north } = boundsOf(geometry);
  const middleLatitude = toRadians((south + north) / 2);
  const cellAreaKm2 = (gridDeg * KM_PER_DEGREE) ** 2 * Math.cos(middleLatitude);
  return Math.round(areaKm2(geometry) / cellAreaKm2);
}

/** A rectangle with sides along meridians and parallels, as a GeoJSON polygon. */
export function rectangleFromBounds({ west, south, east, north }: Bounds): Geometry | null {
  const ring = normalizeRing([
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ]);
  return ring ? { type: 'Polygon', coordinates: [ring] } : null;
}

/**
 * A circle around a point, approximated by a polygon, because the API has no circle type.
 * Returns `null` when the circle would cross the 180th meridian or cover a pole:
 * such areas cannot be written as one simple polygon.
 */
export function circlePolygon(center: LonLat, radiusKm: number, vertices = 64): Geometry | null {
  const [lon, lat] = center;
  const angular = radiusKm / EARTH_RADIUS_KM;
  if (Math.abs(lat) + toDegrees(angular) >= 90) return null;

  const latitude = toRadians(lat);
  const points: LonLat[] = [];
  for (let step = 0; step < vertices; step += 1) {
    // Counter-clockwise from east, the ring direction GeoJSON expects for an outer ring.
    const bearing = Math.PI / 2 - (2 * Math.PI * step) / vertices;
    const pointLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angular) +
        Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing),
    );
    const pointLongitude =
      toRadians(lon) +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude),
        Math.cos(angular) - Math.sin(latitude) * Math.sin(pointLatitude),
      );
    const longitudeDegrees = toDegrees(pointLongitude);
    if (longitudeDegrees < -180 || longitudeDegrees > 180) return null;
    points.push([longitudeDegrees, toDegrees(pointLatitude)]);
  }

  const ring = normalizeRing(points);
  return ring ? { type: 'Polygon', coordinates: [ring] } : null;
}
