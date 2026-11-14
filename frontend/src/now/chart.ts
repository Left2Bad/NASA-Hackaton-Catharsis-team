// Geometry helpers for the small cumulative chart of the "Now" panel.

/** Number of days in a calendar month; `month` is 1 to 12. */
export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * A value axis that starts at zero and ends on a round number: the top of the axis and
 * its tick values. Steps are 1, 2 or 5 times a power of ten, about `target` of them.
 */
export function niceScale(maxValue: number, target = 3): { max: number; ticks: number[] } {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };

  const rough = maxValue / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const count = Math.ceil(maxValue / step - 1e-9);
  // toPrecision removes binary noise such as 0.30000000000000004.
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { max: ticks[ticks.length - 1], ticks };
}

/**
 * Days to label on the time axis: the first, the 10th, the 20th and the last day of the month.
 * Day 30 is skipped on purpose: its label would collide with the label of day 31.
 */
export const dayTicks = (monthLength: number): number[] => [1, 10, 20, monthLength];

/** An SVG path through the points, or an empty string when there are none. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
}
