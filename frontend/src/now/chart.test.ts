import { describe, expect, it } from 'vitest';
import { dayTicks, daysInMonth, linePath, niceScale } from './chart';

describe('daysInMonth', () => {
  it('knows the length of every kind of month', () => {
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
});

describe('niceScale', () => {
  it('ends the axis on a round number above the data', () => {
    expect(niceScale(25.7)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
    expect(niceScale(4200)).toEqual({ max: 6000, ticks: [0, 2000, 4000, 6000] });
    expect(niceScale(0.42)).toEqual({ max: 0.6, ticks: [0, 0.2, 0.4, 0.6] });
  });

  it('does not add a step when the data ends exactly on a tick', () => {
    expect(niceScale(30)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
  });

  it('still gives an axis when every value is zero', () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
  });
});

describe('dayTicks', () => {
  it('labels the first, the 10th, the 20th and the last day', () => {
    expect(dayTicks(30)).toEqual([1, 10, 20, 30]);
    expect(dayTicks(28)).toEqual([1, 10, 20, 28]);
  });
});

describe('linePath', () => {
  it('joins the points with straight segments', () => {
    expect(
      linePath([
        [0, 10],
        [5, 2.25],
      ]),
    ).toBe('M0.0 10.0 L5.0 2.3');
  });

  it('is empty without points', () => {
    expect(linePath([])).toBe('');
  });
});
