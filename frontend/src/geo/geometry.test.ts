import { describe, expect, it } from 'vitest';
import type { Geometry } from '../api/types';
import { boundsOf, formatBounds, geometryFromRings, normalizeRing, outerRings } from './geometry';

const square: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [61, 51],
      [71, 51],
      [71, 55],
      [61, 55],
      [61, 51],
    ],
  ],
};

describe('boundsOf and outerRings', () => {
  it('finds the extent of a polygon', () => {
    expect(boundsOf(square)).toEqual({ west: 61, south: 51, east: 71, north: 55 });
  });

  it('covers every part of a multipolygon', () => {
    const two: Geometry = {
      type: 'MultiPolygon',
      coordinates: [
        square.coordinates as [number, number][][],
        [
          [
            [-10, -5],
            [-8, -5],
            [-8, -3],
            [-10, -5],
          ],
        ],
      ],
    };
    expect(outerRings(two)).toHaveLength(2);
    expect(boundsOf(two)).toEqual({ west: -10, south: -5, east: 71, north: 55 });
  });
});

describe('normalizeRing', () => {
  it('rounds coordinates to four decimals and closes the ring', () => {
    expect(
      normalizeRing([
        [61.123456, 51.000049],
        [71, 51],
        [71, 55],
      ]),
    ).toEqual([
      [61.1235, 51],
      [71, 51],
      [71, 55],
      [61.1235, 51],
    ]);
  });

  it('keeps an already closed ring closed exactly once', () => {
    const ring = normalizeRing(square.coordinates[0]);
    expect(ring).toHaveLength(5);
    expect(ring?.[0]).toEqual(ring?.[4]);
  });

  it('drops repeated points', () => {
    expect(
      normalizeRing([
        [0, 0],
        [0, 0],
        [1, 0],
        [1, 1],
        [1, 1],
        [0, 0],
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
  });

  it('keeps coordinates inside the valid range', () => {
    const ring = normalizeRing([
      [-190, -95],
      [190, -95],
      [0, 95],
    ]);
    expect(ring).toEqual([
      [-180, -90],
      [180, -90],
      [0, 90],
      [-180, -90],
    ]);
  });

  it('rejects a shape with fewer than three distinct points', () => {
    expect(
      normalizeRing([
        [0, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toBeNull();
    expect(normalizeRing([])).toBeNull();
  });
});

describe('geometryFromRings', () => {
  it('makes a Polygon from one ring', () => {
    expect(geometryFromRings([square.coordinates[0]])).toEqual(square);
  });

  it('makes a MultiPolygon from several rings', () => {
    const geometry = geometryFromRings([
      square.coordinates[0],
      [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
    ]);
    expect(geometry?.type).toBe('MultiPolygon');
    expect(geometry?.coordinates).toHaveLength(2);
  });

  it('returns null when nothing usable was drawn', () => {
    expect(geometryFromRings([])).toBeNull();
    expect(
      geometryFromRings([
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toBeNull();
  });
});

describe('formatBounds', () => {
  it('writes hemispheres as letters', () => {
    expect(formatBounds({ west: 61, south: 51, east: 71, north: 55 })).toBe(
      '61°E to 71°E, 51°N to 55°N',
    );
    expect(formatBounds({ west: -62, south: -13, east: -52.5, north: -7 })).toBe(
      '62°W to 52.5°W, 13°S to 7°S',
    );
  });
});
