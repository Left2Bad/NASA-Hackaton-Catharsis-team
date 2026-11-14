import type { MonthValue } from '../api/types';

/**
 * The month whose hot spots the map shows before the user picks one: the latest complete month
 * with detections, else the latest month with any (only the current, partial month has fire).
 * `null` when the area has no fire at all.
 */
export function defaultSpotsMonth(months: readonly MonthValue[]): MonthValue | null {
  let latestAny: MonthValue | null = null;
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const month = months[i];
    if (!(month.value > 0)) continue;
    if (!month.partial) return month;
    latestAny ??= month;
  }
  return latestAny;
}
