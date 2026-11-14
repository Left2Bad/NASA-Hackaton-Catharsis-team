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
 * The sensor era of a month: the source whose period in /meta holds the first day of
 * the month. A month taken from another satellite during an outage stays in its era.
 * Without a matching period, the month's own source is used.
 */
function eraOf(month: MonthValue, sources: readonly SourceInfo[]): string {
  const day = `${month.year}-${String(month.month).padStart(2, '0')}-01`;
  const era = sources.find(
    (source) => source.start <= day && (source.end === null || day <= source.end),
  );
  return era?.id ?? month.source;
}

/**
 * Prepares the cells of the year-by-month grid and marks the seams: the places
 * where the harmonized record passes from one lead sensor to another.
 *
 * A seam on the left: the sensor era changed since the previous month.
 * A seam below: another era held the same month a year earlier.
 * Together they form a stepped line between sensor eras.
 */
export function buildCells(
  months: readonly MonthValue[],
  sources: readonly SourceInfo[],
  colorOf: (month: MonthValue) => string | null,
): (year: number, month: number) => HeatCell | undefined {
  const byKey = new Map(months.map((m) => [keyOf(m.year, m.month), m]));
  const eras = new Map(months.map((m) => [keyOf(m.year, m.month), eraOf(m, sources)]));

  return (year, month) => {
    const key = keyOf(year, month);
    const current = byKey.get(key);
    if (!current) return undefined;
    const era = eras.get(key);

    // The previous month counts only within the same row: January has the year label on its left.
    const previous = month > 1 ? eras.get(keyOf(year, month - 1)) : undefined;
    const yearBefore = eras.get(keyOf(year - 1, month));

    return {
      color: colorOf(current),
      seamLeft: previous !== undefined && previous !== era,
      seamBottom: yearBefore !== undefined && yearBefore !== era,
    };
  };
}

/**
 * Sensor-era labels for the right edge of the grid: the source name next to
 * the middle of the period in which it leads the record, for the sources that
 * lead in at least one of the years on screen.
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
    const first = Number(source.start.slice(0, 4));
    const last = source.end === null ? newest : Number(source.end.slice(0, 4));
    // A source that led only outside the years on screen gets no label.
    if (first > newest || last < oldest) continue;
    const start = clamp(first);
    const end = clamp(last);
    let year = Math.round((start + end) / 2);
    while (taken.has(year) && year > oldest) year -= 1;
    if (taken.has(year)) continue;
    taken.add(year);
    labels.push({ year, text: SOURCE_LABELS[source.id] });
  }
  return labels;
}
