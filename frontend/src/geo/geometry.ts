import type { Geometry } from '../api/types';

// Helpers for the area of interest. Coordinates follow GeoJSON order: [longitude, latitude].

export type LonLat = [number, number];

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Decimal places kept in coordinates sent to the API: 4 places is about 11 m. */
const PRECISION = 4;

const round = (value: number) => Number(value.toFixed(PRECISION));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Outer rings of a geometry: one for a polygon, one per part for a multipolygon. */
export function outerRings(geometry: Geometry): LonLat[][] {
  return geometry.type === 'Polygon'
    ? [geometry.coordinates[0]]
    : geometry.coordinates.map((polygon) => polygon[0]);
}

/** Bounding box of a geometry. */
export function boundsOf(geometry: Geometry): Bounds {
  const points = outerRings(geometry).flat();
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}

/**
 * Cleans a ring drawn on the map so it is valid for the API contract:
 * rounds coordinates, keeps them inside the valid range, drops repeated
 * points and closes the ring. Returns `null` when fewer than three distinct
 * points remain, because that is not an area.
 */
export function normalizeRing(ring: readonly (readonly number[])[]): LonLat[] | null {
  const points: LonLat[] = [];
  for (const [lon, lat] of ring) {
    const point: LonLat = [round(clamp(lon, -180, 180)), round(clamp(lat, -90, 90))];
    const previous = points[points.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
  }

  // Remove the closing point for now; it is added back once the ring is checked.
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) points.pop();

  const distinct = new Set(points.map(([lon, lat]) => `${lon},${lat}`));
  if (distinct.size < 3) return null;

  return [...points, [points[0][0], points[0][1]]];
}

/**
 * Builds the request geometry from the outer rings drawn on the map:
 * one ring gives a Polygon, several give a MultiPolygon. Rings that are
 * not areas are skipped; `null` means nothing usable was drawn.
 */
export function geometryFromRings(
  rings: readonly (readonly (readonly number[])[])[],
): Geometry | null {
  const valid = rings.map(normalizeRing).filter((ring): ring is LonLat[] => ring !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return { type: 'Polygon', coordinates: [valid[0]] };
  return { type: 'MultiPolygon', coordinates: valid.map((ring) => [ring]) };
}

const degrees = (value: number) => Number(Math.abs(value).toFixed(2));

export const formatLon = (lon: number) => `${degrees(lon)}°${lon < 0 ? 'W' : 'E'}`;
export const formatLat = (lat: number) => `${degrees(lat)}°${lat < 0 ? 'S' : 'N'}`;

/** Human-readable extent, for example "61°E to 71°E, 51°N to 55°N". */
export function formatBounds({ west, south, east, north }: Bounds): string {
  return `${formatLon(west)} to ${formatLon(east)}, ${formatLat(south)} to ${formatLat(north)}`;
}
