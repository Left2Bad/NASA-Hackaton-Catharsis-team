import type { PointsResponse } from '../api/types';
import { formatNumber, monthName } from '../labels';
import { quantileBreaks } from '../theme/scales';

// The hot spots that are drawn on the map (requirement F13): which months they cover,
// how they are colored by fire radiative power, and the words that describe them.

/** A month as one number, so months can be compared and stepped through: year × 12 + month − 1. */
export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

/** The year and the month (1 to 12) behind a month index. */
export const monthOf = (index: number) => ({
  year: Math.floor(index / 12),
  month: (index % 12) + 1,
});

/** "2020-09": the id the calendar gives its cells. */
export function monthId(index: number): string {
  const { year, month } = monthOf(index);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The longest span of months the map shows at once. Every month is a request of up to
 * `limits.max_points` detections, so a long span would be slow to load and to draw.
 */
export const MAX_SPAN_MONTHS = 6;

/** The months of a span, first to last. */
export function spanMonths(first: number, last: number): { year: number; month: number }[] {
  return Array.from({ length: last - first + 1 }, (_, step) => monthOf(first + step));
}

/** "October 2026", "August to October 2020", "November 2019 to February 2020". */
export function spanLabel(first: number, last: number): string {
  const from = monthOf(first);
  const to = monthOf(last);
  if (first === last) return `${monthName(from.month)} ${from.year}`;
  if (from.year === to.year) {
    return `${monthName(from.month)} to ${monthName(to.month)} ${to.year}`;
  }
  return `${monthName(from.month)} ${from.year} to ${monthName(to.month)} ${to.year}`;
}

/**
 * A span after one of its ends was moved: the ends never cross, the span stays inside the
 * record, and it never grows past `MAX_SPAN_MONTHS` (the other end follows the moved one).
 */
export function moveSpan(
  span: { first: number; last: number },
  end: 'first' | 'last',
  value: number,
  record: { min: number; max: number },
): { first: number; last: number } {
  const moved = Math.max(record.min, Math.min(value, record.max));
  const longest = MAX_SPAN_MONTHS - 1;
  if (end === 'first') {
    const last = Math.max(span.last, moved);
    return { first: moved, last: Math.min(last, moved + longest) };
  }
  const first = Math.min(span.first, moved);
  return { first: Math.max(first, moved - longest), last: moved };
}

/** Colors of the fire-power classes, from the weakest fires to the strongest. */
export const FRP_RAMP = ['#ffd166', '#f9a03f', '#f3722c', '#d62828', '#7a0c1f'] as const;

/**
 * Class boundaries of fire radiative power, in MW, at quantiles of the points that are
 * drawn: most detections are weak, and a linear scale would paint them all one color.
 */
export function frpBreaks(points: PointsResponse | null | undefined): number[] {
  if (!points) return [];
  const powers = points.features.flatMap((feature) =>
    feature.properties.frp === null ? [] : [feature.properties.frp],
  );
  return quantileBreaks(powers, FRP_RAMP.length);
}

/** The color of every class: one more than there are boundaries, spread over the ramp. */
export function frpColors(breaks: readonly number[]): string[] {
  const last = FRP_RAMP.length - 1;
  return Array.from({ length: breaks.length + 1 }, (_, index) =>
    breaks.length === 0 ? FRP_RAMP[2] : FRP_RAMP[Math.round((index / breaks.length) * last)],
  );
}

/**
 * The answers of several months as one collection. When they hold more points than the
 * map draws, the strongest fires are kept, as the API does within a month.
 */
export function mergePoints(answers: readonly PointsResponse[], cap: number): PointsResponse {
  if (answers.length === 1) return answers[0];
  const all = answers.flatMap((answer) => answer.features);
  const cut = all.length > cap;
  const features = cut
    ? [...all].sort((a, b) => (b.properties.frp ?? 0) - (a.properties.frp ?? 0)).slice(0, cap)
    : all;
  return {
    type: 'FeatureCollection',
    features,
    total: answers.reduce((sum, answer) => sum + answer.total, 0),
    truncated: cut || answers.some((answer) => answer.truncated),
  };
}

/** How many of the drawn points are at least this strong. */
export const countFrom = (points: PointsResponse, minFrp: number) =>
  points.features.filter((feature) => (feature.properties.frp ?? 0) >= minFrp).length;

/** What the strip says about the hot spots that are drawn. `when` is the label of the span. */
export function spotsSummary(points: PointsResponse, when: string, minFrp = 0): string {
  if (points.total === 0) return `No hot spots in ${when}.`;
  // Above the limit the strongest fires are kept, so the map still covers the whole span.
  const shown = points.truncated
    ? `the ${formatNumber(points.features.length)} strongest of ${formatNumber(points.total)} hot spots`
    : `${formatNumber(points.total)} hot ${points.total === 1 ? 'spot' : 'spots'}`;
  const filtered =
    minFrp > 0
      ? ` Shown: ${formatNumber(countFrom(points, minFrp))} of ${formatNumber(minFrp)} MW or more.`
      : '';
  return `${when}: ${shown} on the map, all sensors.${filtered}`;
}
