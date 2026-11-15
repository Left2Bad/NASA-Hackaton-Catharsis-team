import { describe, expect, it } from 'vitest';
import pointsJson from '../../../contract/examples/points.response.json';
import type { MonthValue, PointsResponse } from '../api/types';
import { spanFileName } from '../export/files';
import {
  calendarCount,
  countFrom,
  FRP_RAMP,
  frpBreaks,
  frpColors,
  MAX_SPAN_MONTHS,
  mergePoints,
  monthId,
  monthIndex,
  monthOf,
  moveSpan,
  spanLabel,
  spanMonths,
  spotsSummary,
} from './spots';

const points = pointsJson as unknown as PointsResponse;
const withPowers = (powers: (number | null)[]): PointsResponse => ({
  type: 'FeatureCollection',
  features: powers.map((frp) => ({
    ...points.features[0],
    properties: { ...points.features[0].properties, frp },
  })),
  total: powers.length,
  truncated: false,
});
const record = { min: monthIndex(2000, 11), max: monthIndex(2026, 11) };

describe('months as numbers', () => {
  it('goes from a month to its index and back', () => {
    const index = monthIndex(2020, 9);
    expect(monthOf(index)).toEqual({ year: 2020, month: 9 });
    expect(monthId(index)).toBe('2020-09');
    expect(monthOf(monthIndex(2019, 12) + 1)).toEqual({ year: 2020, month: 1 });
  });

  it('lists the months of a span across a new year', () => {
    expect(spanMonths(monthIndex(2019, 11), monthIndex(2020, 2))).toEqual([
      { year: 2019, month: 11 },
      { year: 2019, month: 12 },
      { year: 2020, month: 1 },
      { year: 2020, month: 2 },
    ]);
  });

  it('names a month, a span inside a year and a span across years', () => {
    expect(spanLabel(monthIndex(2026, 10), monthIndex(2026, 10))).toBe('October 2026');
    expect(spanLabel(monthIndex(2020, 8), monthIndex(2020, 10))).toBe('August to October 2020');
    expect(spanLabel(monthIndex(2019, 11), monthIndex(2020, 2))).toBe(
      'November 2019 to February 2020',
    );
  });

  it('names the file of a month and of a span', () => {
    const scope = { geometry: points.features[0].geometry as never, presetId: 'kz-steppe' };
    expect(spanFileName(scope, monthIndex(2020, 9), monthIndex(2020, 9))).toBe(
      'firms-hotspots_kz-steppe_2020-09.csv',
    );
    expect(spanFileName(scope, monthIndex(2020, 8), monthIndex(2020, 10))).toBe(
      'firms-hotspots_kz-steppe_2020-08_2020-10.csv',
    );
  });
});

describe('moveSpan', () => {
  const span = { first: monthIndex(2020, 8), last: monthIndex(2020, 9) };

  it('moves one end and leaves the other', () => {
    expect(moveSpan(span, 'last', monthIndex(2020, 11), record)).toEqual({
      first: monthIndex(2020, 8),
      last: monthIndex(2020, 11),
    });
  });

  it('never lets the ends cross: the other end follows', () => {
    expect(moveSpan(span, 'first', monthIndex(2021, 3), record)).toEqual({
      first: monthIndex(2021, 3),
      last: monthIndex(2021, 3),
    });
    expect(moveSpan(span, 'last', monthIndex(2019, 5), record)).toEqual({
      first: monthIndex(2019, 5),
      last: monthIndex(2019, 5),
    });
  });

  it('keeps the span within the longest one the map shows', () => {
    const moved = moveSpan(span, 'last', monthIndex(2022, 6), record);
    expect(moved.last).toBe(monthIndex(2022, 6));
    expect(moved.last - moved.first + 1).toBe(MAX_SPAN_MONTHS);
  });

  it('stays inside the record', () => {
    expect(moveSpan(span, 'last', record.max + 40, record).last).toBe(record.max);
    expect(moveSpan(span, 'first', record.min - 40, record).first).toBe(record.min);
  });
});

describe('colors by fire power', () => {
  it('sets the class boundaries at quantiles of the drawn points', () => {
    const breaks = frpBreaks(withPowers([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]));
    expect(breaks).toHaveLength(FRP_RAMP.length - 1);
    expect(breaks).toEqual([...breaks].sort((a, b) => a - b));
    // One extreme fire does not stretch the scale: the top class starts far below it.
    expect(breaks[breaks.length - 1]).toBeLessThan(20);
  });

  it('has no classes without points or without measured power', () => {
    expect(frpBreaks(undefined)).toEqual([]);
    expect(frpBreaks(withPowers([null, null]))).toEqual([]);
  });

  it('gives every class a color, from the weakest to the strongest of the ramp', () => {
    expect(frpColors([5, 15, 50, 150])).toEqual([...FRP_RAMP]);
    const fewer = frpColors([10]);
    expect(fewer).toEqual([FRP_RAMP[0], FRP_RAMP[FRP_RAMP.length - 1]]);
    expect(frpColors([])).toHaveLength(1);
  });
});

describe('mergePoints', () => {
  it('returns a single month as it is', () => {
    expect(mergePoints([points], 20000)).toBe(points);
  });

  it('joins months and adds up their totals', () => {
    const merged = mergePoints([withPowers([1, 2]), withPowers([3])], 20000);
    expect(merged.features).toHaveLength(3);
    expect(merged.total).toBe(3);
    expect(merged.truncated).toBe(false);
  });

  it('keeps the strongest fires when there are more than the map draws', () => {
    const merged = mergePoints([withPowers([1, 50, 3]), withPowers([40, null, 2])], 2);
    expect(merged.features.map((feature) => feature.properties.frp)).toEqual([50, 40]);
    expect(merged.total).toBe(6);
    expect(merged.truncated).toBe(true);
  });

  it('stays cut when one of the months was already cut by the server', () => {
    const cut = { ...withPowers([1]), total: 900, truncated: true };
    expect(mergePoints([cut, withPowers([2])], 20000)).toMatchObject({
      total: 901,
      truncated: true,
    });
  });
});

describe('spotsSummary', () => {
  it('says how many points of the span are drawn', () => {
    expect(spotsSummary(withPowers([1, 2, 3]), 'August to October 2020')).toBe(
      'August to October 2020: 3 hot spots on the map, all sensors.',
    );
    expect(spotsSummary({ ...withPowers([]), total: 0 }, 'May 2001')).toBe(
      'No hot spots in May 2001.',
    );
  });

  it('adds how many are left when only stronger fires are shown', () => {
    const drawn = withPowers([1, 20, 300, null]);
    expect(countFrom(drawn, 20)).toBe(2);
    expect(spotsSummary(drawn, 'May 2020', 20)).toBe(
      'May 2020: 4 hot spots on the map, all sensors. Shown: 2 of 20 MW or more.',
    );
  });

  it('adds what the calendar counts for the same span, when it is known', () => {
    expect(spotsSummary(withPowers([1, 2, 3]), 'October 2026', 0, 3143.4)).toBe(
      'October 2026: 3 hot spots, all sensors; the calendar counts 3,143 (VIIRS-equivalent).',
    );
    expect(spotsSummary(withPowers([1, 20, 300]), 'May 2020', 20, 12.5)).toBe(
      'May 2020: 3 hot spots, all sensors; the calendar counts 12.5 (VIIRS-equivalent). Shown: 2 of 20 MW or more.',
    );
    expect(
      spotsSummary({ ...withPowers([1, 2]), total: 900, truncated: true }, 'May 2020', 0, 3),
    ).toBe(
      'May 2020: the 2 strongest of 900 hot spots on the map, all sensors; the calendar counts 3 (VIIRS-equivalent).',
    );
  });
});

describe('calendarCount', () => {
  const month = (year: number, number: number, value: number) =>
    ({ year, month: number, value }) as MonthValue;
  const months = [month(2019, 12, 10), month(2020, 1, 2.5), month(2020, 2, 0)];

  it('sums the calendar months of a span', () => {
    expect(calendarCount(months, monthIndex(2019, 12), monthIndex(2020, 2))).toBe(12.5);
    expect(calendarCount(months, monthIndex(2020, 2), monthIndex(2020, 2))).toBe(0);
  });

  it('is unknown when the calendar does not hold every month of the span', () => {
    expect(calendarCount(months, monthIndex(2020, 2), monthIndex(2020, 3))).toBeNull();
    expect(calendarCount([], monthIndex(2020, 1), monthIndex(2020, 1))).toBeNull();
  });
});
