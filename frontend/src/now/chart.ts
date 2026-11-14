// Time-axis helpers for the small cumulative chart of the "Now" panel.

/** Number of days in a calendar month; `month` is 1 to 12. */
export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Days to label on the time axis: the first, the 10th, the 20th and the last day of the month.
 * Day 30 is skipped on purpose: its label would collide with the label of day 31.
 */
export const dayTicks = (monthLength: number): number[] => [1, 10, 20, monthLength];
