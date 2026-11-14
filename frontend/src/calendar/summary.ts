import type { CalendarResponse } from '../api/types';
import { formatNumber, formatSignedPercent, monthName } from '../labels';

// The summary of four numbers (requirement F16): the most active year, the peak month of
// the season, the detections of the whole period and the direction of the trend.

/** Which way the yearly totals are going. */
export type TrendDirection = 'up' | 'down' | 'flat';

export interface SummaryFact {
  id: 'peak_year' | 'peak_month' | 'total' | 'trend';
  label: string;
  /** The headline value; "—" when the API has none. */
  value: string;
  /** A short line under the value that says what stands behind it. */
  detail: string;
  /** Set only for the trend, so the component can draw an arrow next to the word. */
  trend?: TrendDirection;
}

/** A slope smaller than this, in % per decade, is shown as "no change": it would print as 0. */
const FLAT_BELOW = 0.05;

/** The direction of a trend from the sign of its slope, as the contract describes it. */
export function trendDirection(pctPerDecade: number): TrendDirection {
  if (Math.abs(pctPerDecade) < FLAT_BELOW) return 'flat';
  return pctPerDecade > 0 ? 'up' : 'down';
}

const TREND_WORDS: Record<TrendDirection, string> = {
  up: 'Rising',
  down: 'Falling',
  flat: 'No change',
};

/** The four facts of the summary, ready to display. */
export function summaryFacts(calendar: CalendarResponse): SummaryFact[] {
  const { summary, months, yearly, monthly_baseline: baselines } = calendar;

  const peakYear = yearly.find((year) => year.year === summary.peak_year);
  const peakMonth = baselines.find((baseline) => baseline.month === summary.peak_month);
  const firstYear = months[0]?.year;
  const lastYear = months[months.length - 1]?.year;
  const trend = summary.trend_pct_per_decade;

  return [
    {
      id: 'peak_year',
      label: 'Most active year',
      value: summary.peak_year === null ? '—' : String(summary.peak_year),
      detail: peakYear ? `${formatNumber(Math.round(peakYear.total))} detections` : '',
    },
    {
      id: 'peak_month',
      label: 'Peak month',
      value: summary.peak_month === null ? '—' : monthName(summary.peak_month),
      detail: peakMonth ? `median ${formatNumber(peakMonth.median)}` : '',
    },
    {
      id: 'total',
      label: 'Total detections',
      value: formatNumber(Math.round(summary.total)),
      detail:
        firstYear === undefined
          ? ''
          : firstYear === lastYear
            ? String(firstYear)
            : `${firstYear} to ${lastYear}`,
    },
    trend === null
      ? {
          id: 'trend',
          label: 'Trend',
          value: '—',
          detail: 'too few complete years',
        }
      : {
          id: 'trend',
          label: 'Trend',
          value: TREND_WORDS[trendDirection(trend)],
          detail: `${formatSignedPercent(trend)} per decade`,
          trend: trendDirection(trend),
        },
  ];
}
