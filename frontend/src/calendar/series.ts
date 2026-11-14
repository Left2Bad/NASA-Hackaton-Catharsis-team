import type { CalendarResponse, MonthValue } from '../api/types';

// Series for the two charts under the calendar: the season profile (F17) and the yearly
// totals with a trend (F18). Both are cut from the calendar response that is already
// loaded, so choosing a year needs no new request.

type TrendLine = NonNullable<CalendarResponse['summary']['trend_line']>;

/** One calendar month of the season profile. */
export interface ProfileRow {
  month: number;
  /** The long-term median of this calendar month. */
  median: number;
  /** The usual range: 8 baseline years out of 10 fall between these two. */
  p10: number;
  p90: number;
  /** The month of the chosen year; `null` when that year has no data for it. */
  value: MonthValue | null;
}

/** The season profile of twelve months with the chosen year laid over it. */
export function profileRows(calendar: CalendarResponse, year: number): ProfileRow[] {
  const ofYear = new Map(
    calendar.months.filter((month) => month.year === year).map((month) => [month.month, month]),
  );
  return [...calendar.monthly_baseline]
    .sort((a, b) => a.month - b.month)
    .map((baseline) => ({
      month: baseline.month,
      median: baseline.median,
      p10: baseline.p10,
      p90: baseline.p90,
      value: ofYear.get(baseline.month) ?? null,
    }));
}

/**
 * Index of the month a profile reads out by default: the busiest month of the chosen
 * year, or the month with the highest median when the year has no data.
 */
export function peakIndex(rows: readonly ProfileRow[]): number {
  const score = (row: ProfileRow) => row.value?.value ?? Number.NEGATIVE_INFINITY;
  const hasYear = rows.some((row) => row.value !== null);
  let best = 0;
  rows.forEach((row, index) => {
    const better = hasYear ? score(row) > score(rows[best]) : row.median > rows[best].median;
    if (better) best = index;
  });
  return best;
}

/** The value of the trend line in a year, or `null` outside the years the line covers. */
export function trendAt(line: TrendLine, year: number): number | null {
  if (year < line.start_year || year > line.end_year) return null;
  if (line.end_year === line.start_year) return line.start_value;
  const share = (year - line.start_year) / (line.end_year - line.start_year);
  return line.start_value + (line.end_value - line.start_value) * share;
}

/**
 * Years to label under a chart of yearly values: every year when there is room,
 * otherwise every 2nd, 5th or 10th, on round years, so labels never run together.
 */
export function yearTicks(years: readonly number[], maxLabels: number): number[] {
  const step = [1, 2, 5, 10].find((size) => years.length / size <= maxLabels) ?? 10;
  return years.filter((year) => year % step === 0);
}
