import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import metaJson from '../../../contract/examples/meta.json';
import type { CalendarResponse, Geometry, Meta } from '../api/types';
import { rectangleFromBounds } from '../geo/shapes';
import { areaTooLarge, tailorCalendar } from './tailor';

const example = calendarJson as unknown as CalendarResponse;
const meta = metaJson as unknown as Meta;

const steppe = rectangleFromBounds({ west: 61, south: 51, east: 71, north: 55 }) as Geometry;
const tiny = rectangleFromBounds({ west: 67, south: 53, east: 67.2, north: 53.2 }) as Geometry;
const huge = rectangleFromBounds({ west: -60, south: -40, east: 60, north: 40 }) as Geometry;

describe('tailorCalendar', () => {
  it('keeps the whole record when no period is given', () => {
    const calendar = tailorCalendar(example, { geometry: steppe }, meta);
    expect(calendar.months).toHaveLength(example.months.length);
    expect(calendar.summary.trend_line).toEqual(example.summary.trend_line);
  });

  it('cuts months and yearly totals to the requested years', () => {
    const calendar = tailorCalendar(
      example,
      { geometry: steppe, start_year: 2010, end_year: 2012 },
      meta,
    );
    expect(calendar.months).toHaveLength(36);
    expect(calendar.yearly.map((year) => year.year)).toEqual([2010, 2011, 2012]);
    const total = calendar.months.reduce((sum, month) => sum + month.value, 0);
    expect(calendar.summary.total).toBeCloseTo(total, 1);
    expect(calendar.summary.peak_year).toBe(2010);
  });

  it('reports no trend for a period too short to have one', () => {
    const calendar = tailorCalendar(
      example,
      { geometry: steppe, start_year: 2010, end_year: 2012 },
      meta,
    );
    expect(calendar.summary.trend_pct_per_decade).toBeNull();
    expect(calendar.summary.trend_line).toBeNull();
  });

  it('describes the size of the requested area', () => {
    const calendar = tailorCalendar(example, { geometry: steppe }, meta);
    expect(calendar.area_km2).toBeGreaterThan(290000);
    expect(calendar.area_km2).toBeLessThan(300000);
    expect(calendar.cells).toBeGreaterThan(3900);
  });

  it('warns about an area of only a few grid cells', () => {
    const codes = (geometry: Geometry) =>
      tailorCalendar(example, { geometry }, meta).warnings.map((warning) => warning.code);
    expect(codes(tiny)).toContain('AREA_SMALL');
    expect(codes(steppe)).not.toContain('AREA_SMALL');
  });
});

describe('areaTooLarge', () => {
  it('refuses an area above the limit with the contract error', () => {
    expect(areaTooLarge({ geometry: huge }, meta)?.error.code).toBe('AREA_TOO_LARGE');
  });

  it('accepts an area within the limit', () => {
    expect(areaTooLarge({ geometry: steppe }, meta)).toBeNull();
  });
});
