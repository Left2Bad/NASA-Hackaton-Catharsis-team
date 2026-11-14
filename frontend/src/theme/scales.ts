// The two color scales of the calendar (requirements F11 and F12).
//
// The colors are computed in the OKLCH space rather than picked by eye: lightness changes
// evenly, so the order of the steps reads even without telling hues apart.
// Tests in scales.test.ts lock these properties in, including under three kinds of
// color-vision deficiency. Neither scale uses a red and green pair.

/**
 * Detections scale: one warm hue from light to dark.
 * Seven classes; the darker the cell, the more hot spots.
 */
export const COUNT_RAMP = [
  '#fdf1e4',
  '#f9d1a8',
  '#f2ad6c',
  '#e4852f',
  '#c85d02',
  '#9d3d07',
  '#6a250d',
] as const;

/**
 * Anomaly scale: blue is below the median, orange is above, neutral gray is in the middle.
 * Three steps per branch; the two branches have matching lightness.
 */
export const ANOMALY_RAMP = [
  '#116bb5',
  '#61a0e0',
  '#a4cdf9',
  '#eeedea',
  '#f4bc8c',
  '#da833f',
  '#a74a04',
] as const;

/** Index of the neutral middle of the anomaly scale. */
export const ANOMALY_MIDPOINT = 3;

/**
 * Boundaries of the anomaly classes, in % of the median. They are symmetric as ratios
 * to the median: −60 % and +150 % mean "2.5 times less" and "2.5 times more".
 */
export const ANOMALY_BREAKS = [-60, -33, -10, 10, 50, 150] as const;

/** A month without fires: the value is 0. */
export const ZERO_COLOR = '#ffffff';

/** Class number: how many boundaries the value has reached. A value on a boundary goes up. */
export function classOf(value: number, breaks: readonly number[]): number {
  let index = 0;
  while (index < breaks.length && value >= breaks[index]) index += 1;
  return index;
}

/** Rounds to a number of significant digits, so the legend shows readable numbers. */
export function roundSignificant(value: number, digits = 2): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const magnitude = 10 ** (digits - 1 - Math.floor(Math.log10(Math.abs(value))));
  return Math.round(value * magnitude) / magnitude;
}

/**
 * Class boundaries at quantiles of the positive values. Fire counts are strongly skewed,
 * and a linear scale would hide ordinary months behind one extreme month.
 * Returns up to `classes − 1` increasing boundaries; uniform data gives fewer.
 */
export function quantileBreaks(
  values: readonly number[],
  classes: number = COUNT_RAMP.length,
): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const breaks: number[] = [];
  for (let step = 1; step < classes; step += 1) {
    const position = ((sorted.length - 1) * step) / classes;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const quantile = sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    const rounded = roundSignificant(quantile);
    if (rounded > 0 && (breaks.length === 0 || rounded > breaks[breaks.length - 1])) {
      breaks.push(rounded);
    }
  }
  return breaks;
}

/** Cell color in the detections mode. Zero gets its own color, not the first class. */
export function countColor(value: number, breaks: readonly number[]): string {
  if (value <= 0) return ZERO_COLOR;
  // With fewer boundaries than usual, the classes stretch over the whole scale.
  const index = classOf(value, breaks);
  const last = COUNT_RAMP.length - 1;
  const scaled = breaks.length === 0 ? last : Math.round((index / breaks.length) * last);
  return COUNT_RAMP[scaled];
}

/** Cell color in the anomaly mode. `null` means the anomaly cannot be computed. */
export function anomalyColor(anomalyPct: number | null): string | null {
  if (anomalyPct === null) return null;
  return ANOMALY_RAMP[classOf(anomalyPct, ANOMALY_BREAKS)];
}
