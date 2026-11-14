import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import type { CalendarResponse } from '../api/types';
import { peakIndex, profileRows, trendAt, yearTicks } from './series';

const calendar = calendarJson as unknown as CalendarResponse;

describe('profileRows (F17)', () => {
  it('gives twelve months with the baseline and the chosen year', () => {
    const rows = profileRows(calendar, 2010);

    expect(rows.map((row) => row.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[8]).toMatchObject({ month: 9, median: 779.4, p10: 394.5, p90: 1322.1 });
    expect(rows[8].value?.value).toBe(2243.8);
  });

  it('leaves months empty where the year has no data', () => {
    // The record starts in November 2000.
    const rows = profileRows(calendar, 2000);

    expect(rows.slice(0, 10).every((row) => row.value === null)).toBe(true);
    expect(rows[10].value?.value).toBe(39.7);
    expect(rows[11].value?.value).toBe(24.7);
  });

  it('keeps the baseline when the year is outside the response', () => {
    const rows = profileRows(calendar, 1990);

    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.value === null)).toBe(true);
    expect(rows[4].median).toBe(723.7);
  });

  it('sorts the baseline by month even if the API does not', () => {
    const shuffled: CalendarResponse = {
      ...calendar,
      monthly_baseline: [...calendar.monthly_baseline].reverse(),
    };
    expect(profileRows(shuffled, 2010).map((row) => row.month)).toEqual(
      profileRows(calendar, 2010).map((row) => row.month),
    );
  });
});

describe('peakIndex', () => {
  it('points at the busiest month of the chosen year', () => {
    // May 2010 had 4,120.6 detections, more than any other month of that year.
    expect(peakIndex(profileRows(calendar, 2010))).toBe(4);
    expect(peakIndex(profileRows(calendar, 2000))).toBe(10);
  });

  it('falls back to the month with the highest median when the year is empty', () => {
    const rows = profileRows(calendar, 1990);
    const highest = Math.max(...rows.map((row) => row.median));
    expect(rows[peakIndex(rows)].median).toBe(highest);
  });
});

describe('trendAt (F18)', () => {
  const line = { start_year: 2001, start_value: 4712.7, end_year: 2025, end_value: 3699.1 };

  it('returns the ends of the line exactly', () => {
    expect(trendAt(line, 2001)).toBe(4712.7);
    expect(trendAt(line, 2025)).toBeCloseTo(3699.1);
  });

  it('interpolates between the ends', () => {
    expect(trendAt(line, 2013)).toBeCloseTo((4712.7 + 3699.1) / 2);
  });

  it('has no value outside the years of the fit', () => {
    expect(trendAt(line, 2000)).toBeNull();
    expect(trendAt(line, 2026)).toBeNull();
  });

  it('copes with a line of a single year', () => {
    expect(trendAt({ start_year: 2010, start_value: 5, end_year: 2010, end_value: 5 }, 2010)).toBe(
      5,
    );
  });
});

describe('yearTicks', () => {
  const range = (first: number, last: number) =>
    Array.from({ length: last - first + 1 }, (_, index) => first + index);

  it('labels every year when they all fit', () => {
    expect(yearTicks(range(2010, 2014), 10)).toEqual([2010, 2011, 2012, 2013, 2014]);
  });

  it('thins the labels to round years when they do not fit', () => {
    expect(yearTicks(range(2000, 2026), 10)).toEqual([2000, 2005, 2010, 2015, 2020, 2025]);
    expect(yearTicks(range(2000, 2026), 20)).toEqual(range(2000, 2026).filter((y) => y % 2 === 0));
    expect(yearTicks(range(2000, 2026), 3)).toEqual([2000, 2010, 2020]);
  });
});
