import type { MonthValue, SourceInfo } from '../api/types';
import type { HeatCell } from '../components/HeatGrid';
import { SOURCE_LABELS } from '../labels';

const keyOf = (year: number, month: number) => year * 12 + (month - 1);

/** Years of the series from top to bottom: the newest first. */
export function yearsNewestFirst(months: readonly MonthValue[]): number[] {
  const years = months.map((m) => m.year);
  if (years.length === 0) return [];
  const first = Math.min(...years);
  const last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, index) => last - index);
}

/**
 * Prepares the cells of the year-by-month grid and marks the seams: the places
 * where the harmonized record passes from one lead sensor to another.
 *
 * A seam on the left: the source changed since the previous month.
 * A seam below: another source led the same month a year earlier.
 * Together they form a stepped line between sensor eras.
 */
export function buildCells(
  months: readonly MonthValue[],
  colorOf: (month: MonthValue) => string | null,
): (year: number, month: number) => HeatCell | undefined {
  const byKey = new Map(months.map((m) => [keyOf(m.year, m.month), m]));

  return (year, month) => {
    const current = byKey.get(keyOf(year, month));
    if (!current) return undefined;

    // The previous month counts only within the same row: January has the year label on its left.
    const previous = month > 1 ? byKey.get(keyOf(year, month - 1)) : undefined;
    const yearBefore = byKey.get(keyOf(year - 1, month));

    return {
      color: colorOf(current),
      seamLeft: previous !== undefined && previous.source !== current.source,
      seamBottom: yearBefore !== undefined && yearBefore.source !== current.source,
    };
  };
}

/**
 * Sensor-era labels for the right edge of the grid: the source name next to
 * the middle of the period in which it leads the record.
 */
export function sourceSideLabels(
  sources: readonly SourceInfo[],
  years: readonly number[],
): { year: number; text: string }[] {
  if (years.length === 0) return [];
  const newest = years[0];
  const oldest = years[years.length - 1];
  const clamp = (year: number) => Math.min(newest, Math.max(oldest, year));

  const taken = new Set<number>();
  const labels: { year: number; text: string }[] = [];
  // From newer sources to older ones: when rows are scarce, the newer one gets the place.
  for (const source of [...sources].reverse()) {
    const start = clamp(Number(source.start.slice(0, 4)));
    const end = clamp(source.end === null ? newest : Number(source.end.slice(0, 4)));
    let year = Math.round((start + end) / 2);
    while (taken.has(year) && year > oldest) year -= 1;
    if (taken.has(year)) continue;
    taken.add(year);
    labels.push({ year, text: SOURCE_LABELS[source.id] });
  }
  return labels;
}
