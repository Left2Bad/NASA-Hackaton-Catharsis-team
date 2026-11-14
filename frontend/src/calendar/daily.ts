import type { DailyResponse } from '../api/types';
import { formatNumber, monthName } from '../labels';

// The daily calendar of one year (requirement F14): a row per month, a column per day
// of the month. The helpers here are kept apart from the component so they can be tested.

export type DailyValue = DailyResponse['days'][number];

/** One day placed on the grid. */
export interface DayCell {
  /** Index in `days` of the response. */
  index: number;
  /** 1 to 12. */
  month: number;
  /** 1 to 31. */
  day: number;
  data: DailyValue;
}

/** Places the days of the response on the month-by-day grid. Dates are ISO: "2020-09-07". */
export function dayCells(days: readonly DailyValue[]): DayCell[] {
  return days.map((data, index) => ({
    index,
    month: Number(data.date.slice(5, 7)),
    day: Number(data.date.slice(8, 10)),
    data,
  }));
}

/** The day with the most detections, or -1 for a year without fires. The first one wins a tie. */
export function busiestDay(days: readonly DailyValue[]): number {
  let best = -1;
  days.forEach((day, index) => {
    if (day.value > 0 && (best === -1 || day.value > days[best].value)) best = index;
  });
  return best;
}

/** "September 7, 2020" */
export function dayName(date: string): string {
  return `${monthName(Number(date.slice(5, 7)))} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

/** One sentence for a screen reader and for the readout above the grid. */
export function daySentence(day: DailyValue): string {
  const count = day.value === 1 ? '1 detection' : `${formatNumber(day.value)} detections`;
  return `${dayName(day.date)}: ${count}${day.preliminary ? ', preliminary' : ''}`;
}

/**
 * Where an arrow key leads from a day: left and right step through the days of the year,
 * up and down go to the same day of the neighboring month (or its last day when the month
 * is shorter). Returns the index of the target, or the same index at the edge of the year.
 */
export function stepDay(cells: readonly DayCell[], from: number, key: string): number {
  const current = cells[from];
  if (!current) return from;
  const last = cells.length - 1;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, from - 1);
    case 'ArrowRight':
      return Math.min(last, from + 1);
    case 'Home':
      return cells.findIndex((cell) => cell.month === current.month);
    case 'End':
      return cells.reduce(
        (found, cell) => (cell.month === current.month ? cell.index : found),
        from,
      );
    case 'ArrowUp':
    case 'ArrowDown': {
      const month = current.month + (key === 'ArrowUp' ? -1 : 1);
      const inMonth = cells.filter((cell) => cell.month === month);
      if (inMonth.length === 0) return from;
      const same = inMonth.find((cell) => cell.day === current.day);
      // A shorter month, or a year that ends before this day: the nearest day that exists.
      return (
        same ??
        inMonth.reduce((a, b) =>
          Math.abs(b.day - current.day) < Math.abs(a.day - current.day) ? b : a,
        )
      ).index;
    }
    default:
      return from;
  }
}
