// Две цветовые шкалы календаря (требования F11 и F12 из ТЗ).
//
// Цвета подобраны расчётом в пространстве OKLCH, а не на глаз: светлота меняется
// равномерно, поэтому порядок ступеней читается и без различения оттенков.
// Свойства шкал закреплены тестами в scales.test.ts, в том числе при трёх типах
// дальтонизма. Пары «красный – зелёный» в шкалах нет.

/**
 * Шкала количества: один тёплый оттенок, от светлого к тёмному.
 * Семь классов; чем темнее, тем больше горячих точек.
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
 * Шкала аномалий: синий — ниже медианы, оранжевый — выше, в середине нейтральный серый.
 * По три ступени на ветвь, светлота ветвей симметрична.
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

/** Индекс нейтральной середины в шкале аномалий. */
export const ANOMALY_MIDPOINT = 3;

/**
 * Границы классов аномалии, % к медиане. Они симметричны по отношению значения
 * к медиане: −60 % и +150 % — это «в 2,5 раза меньше» и «в 2,5 раза больше».
 */
export const ANOMALY_BREAKS = [-60, -33, -10, 10, 50, 150] as const;

/** Месяц без пожаров: значение 0. */
export const ZERO_COLOR = '#ffffff';

/** Номер класса: сколько границ не превышает значение. Значение на границе идёт в верхний класс. */
export function classOf(value: number, breaks: readonly number[]): number {
  let index = 0;
  while (index < breaks.length && value >= breaks[index]) index += 1;
  return index;
}

/** Округление до заданного числа значащих цифр — чтобы в легенде были читаемые числа. */
export function roundSignificant(value: number, digits = 2): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const magnitude = 10 ** (digits - 1 - Math.floor(Math.log10(Math.abs(value))));
  return Math.round(value * magnitude) / magnitude;
}

/**
 * Границы классов по квантилям положительных значений. Распределение пожаров сильно
 * скошено, и линейная шкала скрыла бы обычные месяцы за одним экстремальным.
 * Возвращает до `classes − 1` возрастающих границ; для однообразных данных их меньше.
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

/** Цвет ячейки в режиме «количество». Ноль получает отдельный цвет, а не первый класс. */
export function countColor(value: number, breaks: readonly number[]): string {
  if (value <= 0) return ZERO_COLOR;
  // Если границ меньше обычного, классы растягиваются на всю шкалу от светлого к тёмному.
  const index = classOf(value, breaks);
  const last = COUNT_RAMP.length - 1;
  const scaled = breaks.length === 0 ? last : Math.round((index / breaks.length) * last);
  return COUNT_RAMP[scaled];
}

/** Цвет ячейки в режиме «аномалия». `null` — аномалию посчитать нельзя. */
export function anomalyColor(anomalyPct: number | null): string | null {
  if (anomalyPct === null) return null;
  return ANOMALY_RAMP[classOf(anomalyPct, ANOMALY_BREAKS)];
}
