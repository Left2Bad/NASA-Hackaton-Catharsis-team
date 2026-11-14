import type { Geometry } from '../api/types';
import { circlePolygon, rectangleFromBounds } from './shapes';

// Turns what the user typed into the coordinate form into an area, or into a message
// that says exactly what to fix (requirement F2).

export type AreaInputResult =
  { ok: true; geometry: Geometry } | { ok: false; message: string; field: string };

export interface BoundsInput {
  west: string;
  south: string;
  east: string;
  north: string;
}

export interface CircleInput {
  latitude: string;
  longitude: string;
  radiusKm: string;
}

export const MAX_RADIUS_KM = 1000;

/** Reads a number, accepting a decimal comma as well as a point. `null` when it is not a number. */
function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(',', '.').replace('−', '-');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const fail = (field: string, message: string): AreaInputResult => ({ ok: false, field, message });

function readLongitude(text: string, field: string, label: string): number | AreaInputResult {
  const value = parseNumber(text);
  if (value === null) return fail(field, `Enter a number for ${label}.`);
  if (value < -180 || value > 180)
    return fail(field, `${label} must be between −180 and 180 degrees.`);
  return value;
}

function readLatitude(text: string, field: string, label: string): number | AreaInputResult {
  const value = parseNumber(text);
  if (value === null) return fail(field, `Enter a number for ${label}.`);
  if (value < -90 || value > 90) return fail(field, `${label} must be between −90 and 90 degrees.`);
  return value;
}

/** A rectangle from its west, south, east and north bounds in degrees. */
export function areaFromBounds(input: BoundsInput): AreaInputResult {
  const west = readLongitude(input.west, 'west', 'West');
  if (typeof west !== 'number') return west;
  const south = readLatitude(input.south, 'south', 'South');
  if (typeof south !== 'number') return south;
  const east = readLongitude(input.east, 'east', 'East');
  if (typeof east !== 'number') return east;
  const north = readLatitude(input.north, 'north', 'North');
  if (typeof north !== 'number') return north;

  if (west >= east) return fail('east', 'East must be greater than West.');
  if (south >= north) return fail('north', 'North must be greater than South.');

  const geometry = rectangleFromBounds({ west, south, east, north });
  return geometry
    ? { ok: true, geometry }
    : fail('west', 'These bounds are too close together to form an area.');
}

/** A circle from its center and a radius in kilometers. */
export function areaFromCircle(input: CircleInput): AreaInputResult {
  const latitude = readLatitude(input.latitude, 'latitude', 'Latitude');
  if (typeof latitude !== 'number') return latitude;
  const longitude = readLongitude(input.longitude, 'longitude', 'Longitude');
  if (typeof longitude !== 'number') return longitude;

  const radius = parseNumber(input.radiusKm);
  if (radius === null) return fail('radiusKm', 'Enter a number for Radius.');
  if (radius < 1 || radius > MAX_RADIUS_KM)
    return fail('radiusKm', `Radius must be between 1 and ${MAX_RADIUS_KM} km.`);

  const geometry = circlePolygon([longitude, latitude], radius);
  return geometry
    ? { ok: true, geometry }
    : fail(
        'radiusKm',
        'This circle crosses the 180th meridian or a pole. Move the center or reduce the radius.',
      );
}
