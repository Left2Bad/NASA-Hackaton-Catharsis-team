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

// Пороги: разница цветов считается в OKLab × 100. От 8 соседние ступени уверенно
// различимы; ветви шкалы аномалий должны расходиться заметно сильнее.
const MIN_STEP = 8;
const MIN_BRANCH_GAP = 12;

const adjacentPairs = <T>(items: readonly T[]) =>
  items.slice(1).map((item, index) => [items[index], item] as const);

describe.each(VISIONS)('шкалы при зрении: $label', ({ id }) => {
  const count = COUNT_RAMP.map((color) => simulate(color, id));
  const anomaly = ANOMALY_RAMP.map((color) => simulate(color, id));

  it('шкала количества темнеет на каждой ступени', () => {
    for (const [lighter, darker] of adjacentPairs(count)) {
      expect(lightness(darker)).toBeLessThan(lightness(lighter));
    }
  });

  it('соседние ступени шкалы количества различимы', () => {
    for (const [first, second] of adjacentPairs(count)) {
      expect(deltaE(first, second)).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });

  it('обе ветви шкалы аномалий темнеют от середины к краю', () => {
    const blue = anomaly.slice(0, ANOMALY_MIDPOINT + 1).reverse();
    const orange = anomaly.slice(ANOMALY_MIDPOINT);
    for (const branch of [blue, orange]) {
      for (const [nearer, farther] of adjacentPairs(branch)) {
        expect(lightness(farther)).toBeLessThan(lightness(nearer));
      }
    }
  });

  it('соседние ступени шкалы аномалий различимы', () => {
    for (const [first, second] of adjacentPairs(anomaly)) {
      expect(deltaE(first, second)).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });

  it('«ниже медианы» не путается с «выше медианы» на той же ступени', () => {
    for (let step = 1; step <= ANOMALY_MIDPOINT; step += 1) {
      const below = anomaly[ANOMALY_MIDPOINT - step];
      const above = anomaly[ANOMALY_MIDPOINT + step];
      expect(deltaE(below, above)).toBeGreaterThanOrEqual(MIN_BRANCH_GAP);
    }
  });
});

describe('устройство шкал', () => {
  it('середина шкалы аномалий — нейтральный серый', () => {
    expect(chroma(ANOMALY_RAMP[ANOMALY_MIDPOINT])).toBeLessThan(0.01);
  });

  it('ветви шкалы аномалий симметричны по светлоте', () => {
    for (let step = 1; step <= ANOMALY_MIDPOINT; step += 1) {
      const below = lightness(ANOMALY_RAMP[ANOMALY_MIDPOINT - step]);
      const above = lightness(ANOMALY_RAMP[ANOMALY_MIDPOINT + step]);
      expect(Math.abs(below - above)).toBeLessThan(0.02);
    }
  });

  it('границ аномалии на одну меньше, чем цветов, и они симметричны по отношению к медиане', () => {
    expect(ANOMALY_BREAKS).toHaveLength(ANOMALY_RAMP.length - 1);
    const ratios = ANOMALY_BREAKS.map((pct) => 1 + pct / 100);
    for (let index = 0; index < ratios.length / 2; index += 1) {
      const product = ratios[index] * ratios[ratios.length - 1 - index];
      expect(product).toBeGreaterThan(0.98);
      expect(product).toBeLessThan(1.02);
    }
  });
});

describe('симуляция зрения', () => {
  it('не меняет белый, чёрный и серый', () => {
    for (const { id } of VISIONS) {
      expect(simulate('#ffffff', id)).toBe('#ffffff');
      expect(simulate('#000000', id)).toBe('#000000');
      expect(deltaE(simulate('#808080', id), '#808080')).toBeLessThan(1);
    }
  });

  it('сближает красный и зелёный при дейтеранопии — поэтому такой пары в шкалах нет', () => {
    const normal = deltaE('#d03b3b', '#4c9a2a');
    const simulated = deltaE(
      simulate('#d03b3b', 'deuteranopia'),
      simulate('#4c9a2a', 'deuteranopia'),
    );
    expect(simulated).toBeLessThan(normal / 2);
  });
});

describe('классы значений', () => {
  it('classOf считает границы, которые значение достигло', () => {
    const breaks = [10, 20, 30];
    expect(classOf(5, breaks)).toBe(0);
    expect(classOf(10, breaks)).toBe(1);
    expect(classOf(25, breaks)).toBe(2);
    expect(classOf(1000, breaks)).toBe(3);
  });

  it('roundSignificant оставляет две значащие цифры', () => {
    expect(roundSignificant(1234)).toBe(1200);
    expect(roundSignificant(87.6)).toBe(88);
    expect(roundSignificant(0.0456)).toBe(0.046);
    expect(roundSignificant(0)).toBe(0);
  });

  it('квантильные границы возрастают и не учитывают нули', () => {
    const values = [0, 0, ...Array.from({ length: 200 }, (_, index) => (index + 1) ** 2)];
    const breaks = quantileBreaks(values);
    expect(breaks).toHaveLength(COUNT_RAMP.length - 1);
    for (const [lower, upper] of adjacentPairs(breaks)) {
      expect(upper).toBeGreaterThan(lower);
    }
    expect(breaks[0]).toBeGreaterThan(0);
  });

  it('квантильные границы пусты, если пожаров нет', () => {
    expect(quantileBreaks([0, 0, 0])).toEqual([]);
  });

  it('countColor: ноль отдельно, дальше от светлого к тёмному', () => {
    const breaks = [10, 20, 30, 40, 50, 60];
    expect(countColor(0, breaks)).toBe(ZERO_COLOR);
    expect(countColor(1, breaks)).toBe(COUNT_RAMP[0]);
    expect(countColor(35, breaks)).toBe(COUNT_RAMP[3]);
    expect(countColor(999, breaks)).toBe(COUNT_RAMP[6]);
  });

  it('countColor использует всю шкалу, даже если границ мало', () => {
    expect(countColor(1, [10])).toBe(COUNT_RAMP[0]);
    expect(countColor(50, [10])).toBe(COUNT_RAMP[6]);
  });

  it('anomalyColor: синий ниже медианы, серый около нуля, оранжевый выше', () => {
    expect(anomalyColor(-80)).toBe(ANOMALY_RAMP[0]);
    expect(anomalyColor(0)).toBe(ANOMALY_RAMP[ANOMALY_MIDPOINT]);
    expect(anomalyColor(272.9)).toBe(ANOMALY_RAMP[6]);
    expect(anomalyColor(null)).toBeNull();
  });
});
