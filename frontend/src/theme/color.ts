// Работа с цветом: перевод sRGB в линейный RGB и OKLab, разница цветов, контраст WCAG.
// Нужна шкалам календаря и проверкам доступности.

/** Три компоненты цвета: линейный RGB либо OKLab — по контексту функции. */
export type Triplet = [number, number, number];

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** '#rrggbb' → линейный RGB, компоненты 0–1. */
export function hexToLinear(hex: string): Triplet {
  const value = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`Не цвет вида #rrggbb: ${hex}`);
  const channel = (start: number) =>
    srgbToLinear(parseInt(value.slice(start, start + 2), 16) / 255);
  return [channel(0), channel(2), channel(4)];
}

/** Линейный RGB → '#rrggbb'; значения вне 0–1 обрезаются. */
export function linearToHex(rgb: Triplet): string {
  const channel = (c: number) =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, c))))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/** Линейный RGB → OKLab (L — светлота 0–1). */
export function linearToOklab([r, g, b]: Triplet): Triplet {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Насыщенность цвета в OKLCH: у нейтрального серого близка к нулю. */
export function chroma(hex: string): number {
  const [, a, b] = linearToOklab(hexToLinear(hex));
  return Math.hypot(a, b);
}

/** Светлота цвета в OKLab, 0–1. */
export function lightness(hex: string): number {
  return linearToOklab(hexToLinear(hex))[0];
}

/**
 * Разница двух цветов: расстояние в OKLab × 100.
 * Ориентиры: меньше 6 — почти неразличимы, от 8 — уверенно различимы.
 */
export function deltaE(first: string, second: string): number {
  const a = linearToOklab(hexToLinear(first));
  const b = linearToOklab(hexToLinear(second));
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст по WCAG 2: от 1 до 21. Для обычного текста нужно не меньше 4,5. */
export function contrastRatio(first: string, second: string): number {
  const [high, low] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}
