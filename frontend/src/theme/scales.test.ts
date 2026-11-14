import { describe, expect, it } from 'vitest';
import { chroma, deltaE, lightness } from './color';
import { simulate, VISIONS } from './cvd';
import {
  ANOMALY_BREAKS,
  ANOMALY_MIDPOINT,
  ANOMALY_RAMP,
  anomalyColor,
  classOf,
  COUNT_RAMP,
  countColor,
  quantileBreaks,
  roundSignificant,
  ZERO_COLOR,
} from './scales';

// Thresholds: color difference is measured in OKLab × 100. From 8 up neighboring steps
// are easy to tell apart; the two branches of the anomaly scale must differ much more.
const MIN_STEP = 8;
const MIN_BRANCH_GAP = 12;

const adjacentPairs = <T>(items: readonly T[]) =>
  items.slice(1).map((item, index) => [items[index], item] as const);

describe.each(VISIONS)('scales with $label', ({ id }) => {
  const count = COUNT_RAMP.map((color) => simulate(color, id));
  const anomaly = ANOMALY_RAMP.map((color) => simulate(color, id));

  it('the detections scale gets darker at every step', () => {
    for (const [lighter, darker] of adjacentPairs(count)) {
      expect(lightness(darker)).toBeLessThan(lightness(lighter));
    }
  });

  it('neighboring steps of the detections scale can be told apart', () => {
    for (const [first, second] of adjacentPairs(count)) {
      expect(deltaE(first, second)).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });

  it('both branches of the anomaly scale darken from the middle outward', () => {
    const blue = anomaly.slice(0, ANOMALY_MIDPOINT + 1).reverse();
    const orange = anomaly.slice(ANOMALY_MIDPOINT);
    for (const branch of [blue, orange]) {
      for (const [nearer, farther] of adjacentPairs(branch)) {
        expect(lightness(farther)).toBeLessThan(lightness(nearer));
      }
    }
  });

  it('neighboring steps of the anomaly scale can be told apart', () => {
    for (const [first, second] of adjacentPairs(anomaly)) {
      expect(deltaE(first, second)).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });

  it('"below median" is not confused with "above median" at the same step', () => {
    for (let step = 1; step <= ANOMALY_MIDPOINT; step += 1) {
      const below = anomaly[ANOMALY_MIDPOINT - step];
      const above = anomaly[ANOMALY_MIDPOINT + step];
      expect(deltaE(below, above)).toBeGreaterThanOrEqual(MIN_BRANCH_GAP);
    }
  });
});

describe('structure of the scales', () => {
  it('the middle of the anomaly scale is a neutral gray', () => {
    expect(chroma(ANOMALY_RAMP[ANOMALY_MIDPOINT])).toBeLessThan(0.01);
  });

  it('the branches of the anomaly scale have matching lightness', () => {
    for (let step = 1; step <= ANOMALY_MIDPOINT; step += 1) {
      const below = lightness(ANOMALY_RAMP[ANOMALY_MIDPOINT - step]);
      const above = lightness(ANOMALY_RAMP[ANOMALY_MIDPOINT + step]);
      expect(Math.abs(below - above)).toBeLessThan(0.02);
    }
  });

  it('has one boundary fewer than colors, symmetric as ratios to the median', () => {
    expect(ANOMALY_BREAKS).toHaveLength(ANOMALY_RAMP.length - 1);
    const ratios = ANOMALY_BREAKS.map((pct) => 1 + pct / 100);
    for (let index = 0; index < ratios.length / 2; index += 1) {
      const product = ratios[index] * ratios[ratios.length - 1 - index];
      expect(product).toBeGreaterThan(0.98);
      expect(product).toBeLessThan(1.02);
    }
  });
});

describe('vision simulation', () => {
  it('leaves white, black and gray unchanged', () => {
    for (const { id } of VISIONS) {
      expect(simulate('#ffffff', id)).toBe('#ffffff');
      expect(simulate('#000000', id)).toBe('#000000');
      expect(deltaE(simulate('#808080', id), '#808080')).toBeLessThan(1);
    }
  });

  it('brings red and green together in deuteranopia, which is why the scales avoid the pair', () => {
    const normal = deltaE('#d03b3b', '#4c9a2a');
    const simulated = deltaE(
      simulate('#d03b3b', 'deuteranopia'),
      simulate('#4c9a2a', 'deuteranopia'),
    );
    expect(simulated).toBeLessThan(normal / 2);
  });
});

describe('value classes', () => {
  it('classOf counts the boundaries the value has reached', () => {
    const breaks = [10, 20, 30];
    expect(classOf(5, breaks)).toBe(0);
    expect(classOf(10, breaks)).toBe(1);
    expect(classOf(25, breaks)).toBe(2);
    expect(classOf(1000, breaks)).toBe(3);
  });

  it('roundSignificant keeps two significant digits', () => {
    expect(roundSignificant(1234)).toBe(1200);
    expect(roundSignificant(87.6)).toBe(88);
    expect(roundSignificant(0.0456)).toBe(0.046);
    expect(roundSignificant(0)).toBe(0);
  });

  it('quantile boundaries increase and ignore zeros', () => {
    const values = [0, 0, ...Array.from({ length: 200 }, (_, index) => (index + 1) ** 2)];
    const breaks = quantileBreaks(values);
    expect(breaks).toHaveLength(COUNT_RAMP.length - 1);
    for (const [lower, upper] of adjacentPairs(breaks)) {
      expect(upper).toBeGreaterThan(lower);
    }
    expect(breaks[0]).toBeGreaterThan(0);
  });

  it('quantile boundaries are empty when there are no fires', () => {
    expect(quantileBreaks([0, 0, 0])).toEqual([]);
  });

  it('countColor: zero is separate, then light to dark', () => {
    const breaks = [10, 20, 30, 40, 50, 60];
    expect(countColor(0, breaks)).toBe(ZERO_COLOR);
    expect(countColor(1, breaks)).toBe(COUNT_RAMP[0]);
    expect(countColor(35, breaks)).toBe(COUNT_RAMP[3]);
    expect(countColor(999, breaks)).toBe(COUNT_RAMP[6]);
  });

  it('countColor uses the whole scale even with few boundaries', () => {
    expect(countColor(1, [10])).toBe(COUNT_RAMP[0]);
    expect(countColor(50, [10])).toBe(COUNT_RAMP[6]);
  });

  it('anomalyColor: blue below the median, gray near zero, orange above', () => {
    expect(anomalyColor(-80)).toBe(ANOMALY_RAMP[0]);
    expect(anomalyColor(0)).toBe(ANOMALY_RAMP[ANOMALY_MIDPOINT]);
    expect(anomalyColor(272.9)).toBe(ANOMALY_RAMP[6]);
    expect(anomalyColor(null)).toBeNull();
  });
});
