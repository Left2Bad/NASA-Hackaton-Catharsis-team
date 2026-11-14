import { formatCompact, formatNumber } from '../labels';

// Geometry shared by the SVG charts of the panel.

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
 * How to print the ticks of a value axis: in full while the axis stays under 10,000,
 * compact (10K, 20K) once it reaches it. One style per axis.
 */
export const tickFormat = (axisMax: number): ((value: number) => string) =>
  axisMax >= 10_000 ? formatCompact : formatNumber;

/** An SVG path through the points, or an empty string when there are none. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
}
