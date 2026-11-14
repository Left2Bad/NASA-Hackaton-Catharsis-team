import { describe, expect, it } from 'vitest';
import { dayTicks, daysInMonth } from './chart';

describe('daysInMonth', () => {
  it('knows the length of every kind of month', () => {
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
});

describe('dayTicks', () => {
  it('labels the first, the 10th, the 20th and the last day', () => {
    expect(dayTicks(30)).toEqual([1, 10, 20, 30]);
    expect(dayTicks(28)).toEqual([1, 10, 20, 28]);
  });
});
