import { beforeEach, describe, expect, it } from 'vitest';
import dailyExampleJson from '../../../contract/examples/daily.response.json';
import savedCalendarJson from '../../public/snapshot/calendar_kz-steppe.json';
import savedDailyJson from '../../public/snapshot/daily_kz-steppe.json';
import savedIndexJson from '../../public/snapshot/index.json';
import savedMetaJson from '../../public/snapshot/meta.json';
import { ApiError } from './errors';
import {
  calendarCsv,
  isUnreachable,
  packDaily,
  presetIdOf,
  retryServer,
  tailorPeriod,
  trendOf,
  unpackDaily,
  withFallback,
  type SavedDaily,
} from './snapshot';
import type { CalendarResponse, DailyResponse, Meta } from './types';

const saved = savedCalendarJson as unknown as CalendarResponse;
const meta = savedMetaJson as unknown as Meta;
const geometry = meta.presets[0].geometry;

describe('the snapshot in the repository', () => {
  it('comes from the real record, not from synthetic examples', () => {
    expect(savedIndexJson.data_version).toBe(meta.data_version);
    expect(savedIndexJson.data_version).not.toMatch(/synthetic|example|test/i);
    expect(savedIndexJson.areas).toEqual(meta.presets.map((preset) => preset.id));
  });

  it('holds the whole record with the raw sensor counts', () => {
    expect(saved.series).toBe('raw');
    expect(saved.months[0]).toMatchObject({ year: 2000, month: 11 });
    expect(saved.months.every((month) => month.raw !== undefined)).toBe(true);
  });
});

describe('daily values in the snapshot', () => {
  const example = dailyExampleJson as unknown as DailyResponse;
  const savedDaily = savedDailyJson as unknown as SavedDaily;

  it('gives back the answer of the API it was packed from', () => {
    expect(unpackDaily(packDaily([example]), example.year)).toEqual(example);
  });

  it('keeps where the preliminary days begin', () => {
    const answer: DailyResponse = {
      year: 2026,
      unit: example.unit,
      metric: 'count',
      days: [
        { date: '2026-07-30', value: 4, preliminary: false },
        { date: '2026-07-31', value: 6, preliminary: false },
        { date: '2026-08-01', value: 2.5, preliminary: true },
        { date: '2026-08-02', value: 0, preliminary: true },
      ],
    };
    expect(unpackDaily(packDaily([answer]), 2026)).toEqual(answer);
  });

  it('has no answer for a year that was not saved', () => {
    expect(unpackDaily(packDaily([example]), example.year + 1)).toBeNull();
  });

  it('holds every year of the record for an example area', () => {
    const first = Number(meta.first_date.slice(0, 4));
    const last = Number(meta.last_date.slice(0, 4));
    expect(Object.keys(savedDaily.years)).toHaveLength(last - first + 1);

    // The record starts in the middle of its first year and ends in the middle of the last one.
    expect(unpackDaily(savedDaily, first)?.days[0].date).toBe(meta.first_date);
    expect(unpackDaily(savedDaily, last)?.days.at(-1)?.date).toBe(meta.last_date);
    expect(unpackDaily(savedDaily, 2020)?.days).toHaveLength(366);
  });

  it('adds up to the months of the saved calendar', () => {
    // The same harmonized record, by day and by month: the yearly sums must agree.
    const days = unpackDaily(savedDaily, 2020)?.days ?? [];
    const byDay = days.reduce((sum, day) => sum + day.value, 0);
    const byMonth = saved.yearly.find((year) => year.year === 2020)?.total ?? 0;
    expect(byMonth).toBeGreaterThan(0);
    expect(Math.abs(byDay - byMonth) / byMonth).toBeLessThan(0.01);
  });
});

describe('isUnreachable', () => {
  it('is true when no answer came from the server', () => {
    expect(isUnreachable(new ApiError('NETWORK', '', 0))).toBe(true);
    expect(isUnreachable(new ApiError('TIMEOUT', '', 0))).toBe(true);
    expect(isUnreachable(new ApiError('UNKNOWN', '', 502))).toBe(true);
    expect(isUnreachable(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('is false when the server answered, even with an error', () => {
    expect(isUnreachable(new ApiError('AREA_TOO_LARGE', '', 413))).toBe(false);
    expect(isUnreachable(new ApiError('NO_DATA', '', 404))).toBe(false);
    expect(isUnreachable(new ApiError('INTERNAL', '', 500))).toBe(false);
    expect(isUnreachable(new ApiError('UNKNOWN', '', 404))).toBe(false);
  });

  it('is false for a request the app cancelled itself', () => {
    expect(isUnreachable(new DOMException('The request was cancelled', 'AbortError'))).toBe(false);
  });
});

describe('withFallback', () => {
  const live = () => Promise.resolve('live');
  const savedAnswer = () => Promise.resolve('saved');
  const down = () => Promise.reject(new ApiError('NETWORK', '', 0));
  const refused = () => Promise.reject(new ApiError('AREA_TOO_LARGE', '', 413));

  // Each case starts with no memory of an unreachable server.
  beforeEach(() => retryServer());

  it('prefers the server', async () => {
    await expect(withFallback(live, savedAnswer, 'auto')).resolves.toBe('live');
  });

  it('uses the saved answer when the server cannot be reached', async () => {
    await expect(withFallback(down, savedAnswer, 'auto')).resolves.toBe('saved');
  });

  it('does not ask a server again right after it failed to answer', async () => {
    let asked = 0;
    const counted = () => {
      asked += 1;
      return asked === 1 ? down() : live();
    };

    await expect(withFallback(counted, savedAnswer, 'auto')).resolves.toBe('saved');
    // The server is back, but for a minute the saved answers are used without asking it.
    await expect(withFallback(counted, savedAnswer, 'auto')).resolves.toBe('saved');
    expect(asked).toBe(1);

    // "Try the server again" asks it at once.
    retryServer();
    await expect(withFallback(counted, savedAnswer, 'auto')).resolves.toBe('live');
    expect(asked).toBe(2);
  });

  it('keeps asking the server after a cancelled request', async () => {
    const cancelled = new DOMException('The request was cancelled', 'AbortError');
    await expect(withFallback(() => Promise.reject(cancelled), savedAnswer, 'auto')).rejects.toBe(
      cancelled,
    );
    // The next request goes to the server, not to the snapshot.
    await expect(withFallback(() => Promise.resolve('live'), savedAnswer, 'auto')).resolves.toBe(
      'live',
    );
  });

  it('never hides an error the server returned on purpose', async () => {
    await expect(withFallback(refused, savedAnswer, 'auto')).rejects.toMatchObject({
      code: 'AREA_TOO_LARGE',
    });
  });

  it('does not ask the server at all in the "only" mode', async () => {
    let asked = false;
    const spy = () => {
      asked = true;
      return live();
    };
    await expect(withFallback(spy, savedAnswer, 'only')).resolves.toBe('saved');
    expect(asked).toBe(false);
  });

  it('stays out of the way in the "off" mode', async () => {
    await expect(withFallback(down, savedAnswer, 'off')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('reports what the snapshot lacks when both fail', async () => {
    const missing = () => Promise.reject(new ApiError('OFFLINE', '', 0));
    await expect(withFallback(down, missing, 'auto')).rejects.toMatchObject({ code: 'OFFLINE' });
  });
});

describe('presetIdOf', () => {
  it('recognizes the geometry of an example area', () => {
    expect(presetIdOf(geometry, meta)).toBe('kz-steppe');
    // The same shape in a new object: what matters is the coordinates, not the identity.
    expect(presetIdOf(JSON.parse(JSON.stringify(meta.presets[2].geometry)), meta)).toBe(
      'california-north',
    );
  });

  it('knows that a drawn area is not in the snapshot', () => {
    const drawn = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [10, 20],
          [12, 20],
          [12, 22],
          [10, 20],
        ] as [number, number][],
      ],
    };
    expect(presetIdOf(drawn, meta)).toBeNull();
  });
});

describe('trendOf', () => {
  it('fits a straight line through the yearly totals', () => {
    // Totals fall by 10 a year around a mean of 155: -100 per decade, -64.5 % of the mean.
    const years = Array.from({ length: 10 }, (_, index) => ({
      year: 2001 + index,
      total: 200 - index * 10,
    }));
    expect(trendOf(years)).toEqual({
      trend_pct_per_decade: -64.5,
      trend_line: { start_year: 2001, start_value: 200, end_year: 2010, end_value: 110 },
    });
  });

  it('has no trend for fewer than ten years or for a record of zeros', () => {
    const nine = Array.from({ length: 9 }, (_, index) => ({ year: 2001 + index, total: 5 }));
    expect(trendOf(nine)).toEqual({ trend_pct_per_decade: null, trend_line: null });
    const zeros = Array.from({ length: 12 }, (_, index) => ({ year: 2001 + index, total: 0 }));
    expect(trendOf(zeros)).toEqual({ trend_pct_per_decade: null, trend_line: null });
  });

  it('reproduces the trend the API computed for the whole record', () => {
    const complete = saved.yearly.filter((year) => year.complete);
    expect(trendOf(complete)).toEqual({
      trend_pct_per_decade: saved.summary.trend_pct_per_decade,
      trend_line: saved.summary.trend_line,
    });
  });
});

describe('tailorPeriod', () => {
  it('returns the saved calendar untouched for the whole record', () => {
    expect(tailorPeriod(saved, { geometry })).toBe(saved);
    expect(tailorPeriod(saved, { geometry, start_year: 2000, end_year: 2030 })).toBe(saved);
  });

  it('cuts the months and the years and recomputes what depends on the period', () => {
    const cut = tailorPeriod(saved, { geometry, start_year: 2010, end_year: 2021 });

    expect(cut.months[0]).toMatchObject({ year: 2010, month: 1 });
    expect(cut.months).toHaveLength(12 * 12);
    expect(cut.yearly.map((year) => year.year)).toEqual(
      Array.from({ length: 12 }, (_, index) => 2010 + index),
    );
    const sum = cut.months.reduce((total, month) => total + month.value, 0);
    expect(cut.summary.total).toBeCloseTo(sum, 0);
    const best = [...cut.yearly].sort((a, b) => b.total - a.total)[0];
    expect(cut.summary.peak_year).toBe(best.year);
    expect(cut.summary.trend_line).toMatchObject({ start_year: 2010, end_year: 2021 });
  });

  it('keeps what does not depend on the period', () => {
    const cut = tailorPeriod(saved, { geometry, start_year: 2015, end_year: 2020 });

    expect(cut.monthly_baseline).toBe(saved.monthly_baseline);
    expect(cut.baseline).toBe(saved.baseline);
    expect(cut.summary.peak_month).toBe(saved.summary.peak_month);
    // Six years are too few for a trend.
    expect(cut.summary.trend_pct_per_decade).toBeNull();
    expect(cut.summary.trend_line).toBeNull();
  });
});

describe('calendarCsv', () => {
  it('writes the monthly table in the columns of the API export', () => {
    const lines = calendarCsv(saved).trimEnd().split('\n');

    expect(lines[0]).toBe(
      'year,month,value,low,high,median,anomaly_pct,percentile,category,source,preliminary,partial',
    );
    expect(lines).toHaveLength(1 + saved.months.length);
    const first = saved.months[0];
    expect(lines[1].startsWith(`${first.year},${first.month},${first.value},`)).toBe(true);
    expect(lines[1].endsWith(`,${first.source},${first.preliminary},${first.partial}`)).toBe(true);
  });

  it('leaves a missing value empty', () => {
    const month = { ...saved.months[0], anomaly_pct: null, category: null };
    const csv = calendarCsv({ ...saved, months: [month] });
    expect(csv.split('\n')[1].split(',')[6]).toBe('');
    expect(csv.split('\n')[1].split(',')[8]).toBe('');
  });
});
