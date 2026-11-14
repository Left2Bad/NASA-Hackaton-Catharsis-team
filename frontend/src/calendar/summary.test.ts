import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import type { CalendarResponse } from '../api/types';
import { summaryFacts, trendDirection } from './summary';

const calendar = calendarJson as unknown as CalendarResponse;

/** The example with a different summary. */
const withSummary = (summary: Partial<CalendarResponse['summary']>): CalendarResponse => ({
  ...calendar,
  summary: { ...calendar.summary, ...summary },
});

const factOf = (response: CalendarResponse, id: string) => {
  const fact = summaryFacts(response).find((item) => item.id === id);
  if (!fact) throw new Error(`no fact ${id}`);
  return fact;
};

describe('trendDirection', () => {
  it('follows the sign of the slope', () => {
    expect(trendDirection(12.5)).toBe('up');
    expect(trendDirection(-10)).toBe('down');
  });

  it('calls a slope that would print as zero "flat"', () => {
    expect(trendDirection(0)).toBe('flat');
    expect(trendDirection(0.04)).toBe('flat');
    expect(trendDirection(-0.04)).toBe('flat');
  });
});

describe('summaryFacts (F16)', () => {
  it('gives the four facts in a fixed order', () => {
    expect(summaryFacts(calendar).map((fact) => fact.id)).toEqual([
      'peak_year',
      'peak_month',
      'total',
      'trend',
    ]);
  });

  it('backs every number of the example with a detail line', () => {
    expect(factOf(calendar, 'peak_year')).toMatchObject({
      value: '2010',
      detail: '12,877 detections',
    });
    expect(factOf(calendar, 'peak_month')).toMatchObject({
      value: 'September',
      detail: 'median 779',
    });
    expect(factOf(calendar, 'total')).toMatchObject({
      value: '108,872',
      detail: '2000 to 2026',
    });
    expect(factOf(calendar, 'trend')).toMatchObject({
      value: 'Falling',
      detail: '−10 % per decade',
      trend: 'down',
    });
  });

  it('says "rising" for a positive slope', () => {
    expect(factOf(withSummary({ trend_pct_per_decade: 7.5 }), 'trend')).toMatchObject({
      value: 'Rising',
      detail: '+7.5 % per decade',
      trend: 'up',
    });
  });

  it('explains a missing trend instead of showing a direction', () => {
    const fact = factOf(withSummary({ trend_pct_per_decade: null, trend_line: null }), 'trend');
    expect(fact).toMatchObject({ value: '—', detail: 'too few complete years' });
    expect(fact.trend).toBeUndefined();
  });

  it('shows dashes for an area without fires', () => {
    const empty = withSummary({ peak_year: null, peak_month: null, total: 0 });
    expect(factOf(empty, 'peak_year')).toMatchObject({ value: '—', detail: '' });
    expect(factOf(empty, 'peak_month')).toMatchObject({ value: '—', detail: '' });
    expect(factOf(empty, 'total').value).toBe('0');
  });

  it('names a single year when the period is one year long', () => {
    const oneYear: CalendarResponse = {
      ...calendar,
      months: calendar.months.filter((month) => month.year === 2015),
    };
    expect(factOf(oneYear, 'total').detail).toBe('2015');
  });
});
