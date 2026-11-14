import { describe, expect, it } from 'vitest';
import type { Geometry } from '../api/types';
import { areaFromBounds, areaFromCircle } from './coordinateInput';
import { boundsOf } from './geometry';
import { areaKm2, circlePolygon, estimateCells, rectangleFromBounds } from './shapes';

const steppe = rectangleFromBounds({ west: 61, south: 51, east: 71, north: 55 }) as Geometry;

describe('areaKm2', () => {
  it('matches the analytic area of a latitude and longitude rectangle within half a percent', () => {
    // On a sphere the exact area is R² × Δλ × (sin φ2 − sin φ1).
    const exact =
      6371.0088 ** 2 *
      ((10 * Math.PI) / 180) *
      (Math.sin((55 * Math.PI) / 180) - Math.sin((51 * Math.PI) / 180));
    expect(Math.abs(areaKm2(steppe) - exact) / exact).toBeLessThan(0.005);
  });

  it('does not depend on the direction of the ring', () => {
    const reversed: Geometry = {
      type: 'Polygon',
      coordinates: [[...steppe.coordinates[0]].reverse() as [number, number][]],
    };
    expect(areaKm2(reversed)).toBeCloseTo(areaKm2(steppe), 6);
  });

  it('adds up the parts of a multipolygon', () => {
    const two: Geometry = {
      type: 'MultiPolygon',
      coordinates: [
        steppe.coordinates as [number, number][][],
        steppe.coordinates as [number, number][][],
      ],
    };
    expect(areaKm2(two)).toBeCloseTo(2 * areaKm2(steppe), 6);
  });
});

describe('estimateCells', () => {
  it('is close to the number of 0.1° cells in a rectangle', () => {
    // 10° × 4° at a 0.1° step is 100 × 40 = 4000 cells.
    const cells = estimateCells(steppe, 0.1);
    expect(cells).toBeGreaterThan(3900);
    expect(cells).toBeLessThan(4100);
  });
});

describe('rectangleFromBounds', () => {
  it('builds a closed ring of five points', () => {
    expect(steppe.coordinates[0]).toEqual([
      [61, 51],
      [71, 51],
      [71, 55],
      [61, 55],
      [61, 51],
    ]);
  });

  it('returns null for bounds with no extent', () => {
    expect(rectangleFromBounds({ west: 10, south: 5, east: 10, north: 5 })).toBeNull();
  });
});

describe('circlePolygon', () => {
  it('has the area of a circle of that radius', () => {
    const circle = circlePolygon([67, 53], 100) as Geometry;
    const expected = Math.PI * 100 ** 2;
    expect(Math.abs(areaKm2(circle) - expected) / expected).toBeLessThan(0.01);
  });

  it('is centered on the given point', () => {
    const { west, south, east, north } = boundsOf(circlePolygon([67, 53], 100) as Geometry);
    expect((west + east) / 2).toBeCloseTo(67, 1);
    expect((south + north) / 2).toBeCloseTo(53, 1);
  });

  it('is a closed ring', () => {
    const ring = (circlePolygon([0, 0], 50) as Geometry).coordinates[0] as [number, number][];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBe(65);
  });

  it('refuses a circle that crosses the 180th meridian or covers a pole', () => {
    expect(circlePolygon([179.5, 0], 200)).toBeNull();
    expect(circlePolygon([0, 89.5], 200)).toBeNull();
  });
});

describe('areaFromBounds', () => {
  it('accepts bounds, including a decimal comma and a typographic minus', () => {
    const result = areaFromBounds({ west: '−62', south: '-13,5', east: '-52', north: '-7' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(boundsOf(result.geometry)).toEqual({ west: -62, south: -13.5, east: -52, north: -7 });
    }
  });

  it('names the empty field', () => {
    expect(areaFromBounds({ west: '', south: '1', east: '2', north: '3' })).toEqual({
      ok: false,
      field: 'west',
      message: 'Enter a number for West.',
    });
  });

  it('rejects coordinates outside the valid range', () => {
    const result = areaFromBounds({ west: '10', south: '-95', east: '20', north: '5' });
    expect(result).toMatchObject({ ok: false, field: 'south' });
  });

  it('rejects bounds in the wrong order', () => {
    expect(areaFromBounds({ west: '20', south: '0', east: '10', north: '5' })).toMatchObject({
      ok: false,
      field: 'east',
      message: 'East must be greater than West.',
    });
    expect(areaFromBounds({ west: '10', south: '5', east: '20', north: '5' })).toMatchObject({
      ok: false,
      field: 'north',
    });
  });
});

describe('areaFromCircle', () => {
  it('accepts a point and a radius', () => {
    const result = areaFromCircle({ latitude: '53', longitude: '67', radiusKm: '150' });
    expect(result.ok).toBe(true);
  });

  it('rejects a radius outside the allowed range', () => {
    expect(areaFromCircle({ latitude: '53', longitude: '67', radiusKm: '0' })).toMatchObject({
      ok: false,
      field: 'radiusKm',
    });
    expect(areaFromCircle({ latitude: '53', longitude: '67', radiusKm: '5000' })).toMatchObject({
      ok: false,
      field: 'radiusKm',
    });
  });

  it('explains a circle that crosses the 180th meridian', () => {
    const result = areaFromCircle({ latitude: '0', longitude: '179.9', radiusKm: '300' });
    expect(result).toMatchObject({ ok: false, field: 'radiusKm' });
    if (!result.ok) expect(result.message).toMatch(/180th meridian/);
  });
});
