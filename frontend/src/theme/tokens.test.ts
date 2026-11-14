import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color';
import tokensCss from './tokens.css?raw';

/** Значение цветового токена из tokens.css. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss);
  if (!match) throw new Error(`В tokens.css нет цвета --${name}`);
  return match[1];
}

// WCAG AA: обычный текст — контраст не меньше 4,5 к фону.
const AA_TEXT = 4.5;

describe('контраст текста по WCAG AA', () => {
  it.each(['ink', 'ink-2', 'muted'])('--%s читается на обеих поверхностях', (name) => {
    expect(contrastRatio(token(name), token('surface'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token(name), token('plane'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('текст ошибки читается на своём фоне и на белом', () => {
    expect(contrastRatio(token('error'), token('error-surface'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token('error'), token('surface'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('белый текст читается на выбранной кнопке цвета --ink', () => {
    expect(contrastRatio('#ffffff', token('ink'))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
