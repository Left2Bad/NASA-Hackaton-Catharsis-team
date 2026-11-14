import { describe, expect, it } from 'vitest';
import type { MonthValue } from '../api/types';
import { defaultSpotsMonth } from './spots';

const month = (year: number, m: number, value: number, partial = false) =>
  ({ year, month: m, value, partial }) as MonthValue;

describe('defaultSpotsMonth', () => {
  it('takes the latest complete month with fire', () => {
    const months = [
      month(2026, 8, 50),
      month(2026, 9, 12),
      month(2026, 10, 0),
      month(2026, 11, 3, true),
    ];
    expect(defaultSpotsMonth(months)).toMatchObject({ year: 2026, month: 9 });
  });

  it('falls back to the partial month when no complete month has fire', () => {
    expect(defaultSpotsMonth([month(2026, 10, 0), month(2026, 11, 3, true)])).toMatchObject({
      month: 11,
    });
  });

  it('is null for an area without fire', () => {
    expect(defaultSpotsMonth([month(2026, 10, 0), month(2026, 11, 0, true)])).toBeNull();
    expect(defaultSpotsMonth([])).toBeNull();
  });
});
