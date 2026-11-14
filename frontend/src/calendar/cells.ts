import type { MonthValue, SourceInfo } from '../api/types';
import type { HeatCell } from '../components/HeatGrid';
import { SOURCE_LABELS } from '../labels';

const keyOf = (year: number, month: number) => year * 12 + (month - 1);

/** Годы ряда сверху вниз: самый свежий — первым. */
export function yearsNewestFirst(months: readonly MonthValue[]): number[] {
  const years = months.map((m) => m.year);
  if (years.length === 0) return [];
  const first = Math.min(...years);
  const last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, index) => last - index);
}

/**
 * Готовит клетки сетки «год × месяц» и отмечает швы — места, где единый ряд
 * переходит от одного ведущего сенсора к другому.
 *
 * Шов слева — источник сменился по сравнению с предыдущим месяцем.
 * Шов снизу — тот же месяц год назад вёл другой источник.
 * Вместе они складываются в ступенчатую линию между эпохами сенсоров.
 */
export function buildCells(
  months: readonly MonthValue[],
  colorOf: (month: MonthValue) => string | null,
): (year: number, month: number) => HeatCell | undefined {
  const byKey = new Map(months.map((m) => [keyOf(m.year, m.month), m]));

  return (year, month) => {
    const current = byKey.get(keyOf(year, month));
    if (!current) return undefined;

    // Предыдущий месяц учитываем только в той же строке: у января сосед слева — подпись года.
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
 * Подписи эпох сенсоров для правого края сетки: название источника напротив
 * середины периода, когда он ведёт ряд.
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
  // От свежих источников к старым: при тесноте место получает более новый.
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
