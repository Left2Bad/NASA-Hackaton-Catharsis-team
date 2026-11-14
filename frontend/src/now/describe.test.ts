import { describe, expect, it } from 'vitest';
import currentJson from '../../../contract/examples/current.response.json';
import type { CurrentResponse } from '../api/types';
import {
  bandRange,
  CATEGORY_COLORS,
  CATEGORY_ORDER,
  comparison,
  detections,
  levelBands,
  levelStrip,
  nowHeadline,
  periodLabel,
} from './describe';

const current = currentJson as unknown as CurrentResponse;

/** The example with some fields replaced. */
const withFields = (fields: Partial<CurrentResponse>): CurrentResponse => ({
  ...current,
  ...fields,
});

describe('periodLabel', () => {
  it('names the days of the month that are counted', () => {
    expect(periodLabel(current)).toBe('November 1 to 13, 2026');
  });

  it('names a single day on the first day of a month', () => {
    expect(periodLabel(withFields({ days_elapsed: 1 }))).toBe('November 1, 2026');
  });
});

describe('comparison', () => {
  it('gives the difference from the median as a signed percentage', () => {
    expect(comparison(current)).toBe('+48.6 % against the median of the same days');
    expect(comparison(withFields({ anomaly_pct: -20 }))).toBe(
      '−20 % against the median of the same days',
    );
  });

  it('says where the value stands when the median is zero', () => {
    expect(comparison(withFields({ anomaly_pct: null, value: 3.5 }))).toBe(
      'above the median, which is zero',
    );
    expect(comparison(withFields({ anomaly_pct: null, value: 0 }))).toBe(
      'the same as the median, which is zero',
    );
  });
});

describe('detections', () => {
  it('counts detections in words', () => {
    expect(detections(0)).toBe('0 detections');
    expect(detections(1)).toBe('1 detection');
    expect(detections(25.7)).toBe('25.7 detections');
  });
});

describe('nowHeadline', () => {
  it('gives the count once, then the comparison', () => {
    expect(nowHeadline(current).detail).toBe(
      '25.7 detections, +48.6 % against the median of the same days',
    );
  });

  it('reads as one sentence when the median is zero', () => {
    // What the API returns for a box in the Sahara: no fires now and none in any baseline year.
    const desert = withFields({
      value: 0,
      anomaly_pct: null,
      percentile: 50,
      category: 'normal',
      baseline_same_days: { median: 0, p25: 0, p75: 0, p90: 0, max: 0, n_years: 25 },
    });
    expect(nowHeadline(desert).detail).toBe('0 detections, the same as the median, which is zero');
    expect(nowHeadline(withFields({ ...desert, value: 1, category: 'high' })).detail).toBe(
      '1 detection, above the median, which is zero',
    );
  });
});

describe('levelBands', () => {
  it('turns the baseline percentiles into the five levels of the contract', () => {
    const bands = levelBands(current.baseline_same_days);

    expect(bands.map((band) => band.category)).toEqual(CATEGORY_ORDER);
    expect(bands.map(bandRange)).toEqual([
      'below 9.5',
      '9.5 to 25.1',
      '25.1 to 36.3',
      '36.3 to 58.8',
      'above 58.8',
    ]);
  });

  it('names a level that collapses to one value by that value', () => {
    // Most baseline years had no fires on these days, a few had some.
    const bands = levelBands({ median: 0, p25: 0, p75: 0, p90: 4, max: 10, n_years: 25 });
    expect(bands.map(bandRange)).toEqual(['0', '0', '0 to 4', '4 to 10', 'above 10']);
  });

  it('gives the normal level from zero as a range, not as "below"', () => {
    const bands = levelBands({ median: 2, p25: 0, p75: 5, p90: 8, max: 12, n_years: 25 });
    expect(bandRange(bands[1])).toBe('0 to 5');
  });

  it('puts the example value into the level the API reports', () => {
    const band = levelBands(current.baseline_same_days).find(
      (item) => current.value >= item.from && (item.to === null || current.value < item.to),
    );
    expect(band?.category).toBe(current.category);
  });

  it('gives every level its own color', () => {
    expect(new Set(CATEGORY_ORDER.map((category) => CATEGORY_COLORS[category])).size).toBe(5);
  });
});

describe('levelStrip', () => {
  it('lays the levels end to end and keeps a sliver for a record', () => {
    const strip = levelStrip(current);
    if (!strip) throw new Error('the example must give a strip');

    expect(strip.segments.map((segment) => segment.category)).toEqual(CATEGORY_ORDER);
    expect(strip.segments[0].start).toBe(0);
    for (let i = 1; i < strip.segments.length; i += 1) {
      expect(strip.segments[i].start).toBeCloseTo(strip.segments[i - 1].end);
    }
    expect(strip.segments[4].end).toBe(1);
    // The mark sits inside the "above normal" segment.
    expect(strip.marker).toBeGreaterThan(strip.segments[2].start);
    expect(strip.marker).toBeLessThan(strip.segments[2].end);
  });

  it('stretches the scale when the value is above the baseline maximum', () => {
    const strip = levelStrip(withFields({ value: 80, category: 'record' }));
    if (!strip) throw new Error('a record value must give a strip');

    const record = strip.segments[strip.segments.length - 1];
    expect(record.category).toBe('record');
    expect(strip.marker).toBeGreaterThan(record.start);
    expect(strip.marker).toBeLessThan(1);
  });

  it('drops levels that collapse because percentiles coincide', () => {
    const strip = levelStrip(
      withFields({
        value: 0,
        baseline_same_days: { median: 0, p25: 0, p75: 0, p90: 4, max: 10, n_years: 25 },
      }),
    );
    expect(strip?.segments.map((segment) => segment.category)).toEqual([
      'above_normal',
      'high',
      'record',
    ]);
  });

  it('draws nothing when there are no fires now and none in the baseline years', () => {
    const strip = levelStrip(
      withFields({
        value: 0,
        baseline_same_days: { median: 0, p25: 0, p75: 0, p90: 0, max: 0, n_years: 25 },
      }),
    );
    expect(strip).toBeNull();
  });
});
