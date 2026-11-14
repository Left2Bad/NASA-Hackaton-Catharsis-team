import type { CurrentResponse } from '../api/types';
import { CATEGORY_LABELS, formatNumber, formatSignedPercent, monthName } from '../labels';
import { ANOMALY_RAMP } from '../theme/scales';

// Words and numbers of the "Now" panel (requirement F15): the current month so far against
// the same days of the baseline years. Kept apart from the component so it can be tested alone.

export type Category = NonNullable<CurrentResponse['category']>;
type Baseline = CurrentResponse['baseline_same_days'];

/** The five levels from the quietest to the most active, as the contract defines them. */
export const CATEGORY_ORDER: readonly Category[] = [
  'below_normal',
  'normal',
  'above_normal',
  'high',
  'record',
];

/**
 * Level colors: steps of the anomaly scale, so "now" reads like the calendar's anomaly mode.
 * Blue is below the usual range, neutral gray is inside it, orange is above.
 */
export const CATEGORY_COLORS: Record<Category, string> = {
  below_normal: ANOMALY_RAMP[1],
  normal: ANOMALY_RAMP[3],
  above_normal: ANOMALY_RAMP[4],
  high: ANOMALY_RAMP[5],
  record: ANOMALY_RAMP[6],
};

/** The days the panel covers: "November 1 to 13, 2026". */
export function periodLabel(current: CurrentResponse): string {
  const { year, month, days_elapsed: days } = current;
  const range = days > 1 ? `1 to ${days}` : '1';
  return `${monthName(month)} ${range}, ${year}`;
}

/** How the value compares with the median of the same days. */
export function comparison(current: CurrentResponse): string {
  if (current.anomaly_pct !== null) {
    return `${formatSignedPercent(current.anomaly_pct)} against the median of the same days`;
  }
  // The median is zero, so a percentage has no meaning: say how many detections there were.
  return current.value > 0
    ? `${formatNumber(current.value)} above a median of zero`
    : 'No detections, the same as the median';
}

/**
 * The current month in one line, for the top of the panel: the question an emergency
 * manager opens the app with is answered before anything else. The "Now" section below
 * has the numbers behind it.
 */
export function nowHeadline(current: CurrentResponse): {
  /** "Now, November 1 to 13, 2026" */
  label: string;
  /** The level in words, or `null` when the month cannot be placed on the levels. */
  level: string | null;
  /** The color of the level, drawn as a small square next to the word. */
  color: string | null;
  /** The count and how it compares with the median. */
  detail: string;
} {
  return {
    label: `Now, ${periodLabel(current)}`,
    level: current.category === null ? null : CATEGORY_LABELS[current.category],
    color: current.category === null ? null : CATEGORY_COLORS[current.category],
    detail: `${formatNumber(current.value)} detections, ${comparison(current)}`,
  };
}

/** One level on the scale of the baseline years. `to` is `null` for the open-ended top level. */
export interface LevelBand {
  category: Category;
  from: number;
  to: number | null;
}

/** The value ranges of the five levels, from the percentiles of the same days in baseline years. */
export function levelBands(baseline: Baseline): LevelBand[] {
  return [
    { category: 'below_normal', from: 0, to: baseline.p25 },
    { category: 'normal', from: baseline.p25, to: baseline.p75 },
    { category: 'above_normal', from: baseline.p75, to: baseline.p90 },
    { category: 'high', from: baseline.p90, to: baseline.max },
    { category: 'record', from: baseline.max, to: null },
  ];
}

/** The range of a level in words: "below 9.5", "9.5 to 25.1", "above 58.8". */
export function bandRange(band: LevelBand): string {
  if (band.to === null) return `above ${formatNumber(band.from)}`;
  if (band.from === 0) return `below ${formatNumber(band.to)}`;
  return `${formatNumber(band.from)} to ${formatNumber(band.to)}`;
}

/** A level drawn on the strip: where it starts and ends, as shares of the strip from 0 to 1. */
export interface StripSegment {
  category: Category;
  start: number;
  end: number;
}

/**
 * Geometry of the level strip: the scale runs from zero a little past the baseline maximum
 * (or past the value, when it is a record), so the open-ended "record" level stays visible.
 * Returns `null` when there is nothing to draw: no fires now and none in the baseline years.
 */
export function levelStrip(
  current: CurrentResponse,
): { segments: StripSegment[]; marker: number } | null {
  const { value, baseline_same_days: baseline } = current;
  const upper = Math.max(baseline.max * 1.08, value * 1.04);
  if (upper <= 0) return null;

  const segments = levelBands(baseline)
    .map((band) => ({
      category: band.category,
      start: band.from / upper,
      end: (band.to ?? upper) / upper,
    }))
    // Levels can collapse where percentiles coincide, for example in an area with rare fires.
    .filter((segment) => segment.end > segment.start);
  return { segments, marker: value / upper };
}
