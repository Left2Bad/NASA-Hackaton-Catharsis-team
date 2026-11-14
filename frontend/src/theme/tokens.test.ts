import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color';
import tokensCss from './tokens.css?raw';

/** The value of a color token from tokens.css. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss);
  if (!match) throw new Error(`tokens.css has no color --${name}`);
  return match[1];
}

// WCAG AA: normal text needs a contrast of at least 4.5 against its background.
const AA_TEXT = 4.5;

describe('text contrast, WCAG AA', () => {
  it.each(['ink', 'ink-2', 'muted'])('--%s is readable on both surfaces', (name) => {
    expect(contrastRatio(token(name), token('surface'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token(name), token('plane'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('error text is readable on its own background and on white', () => {
    expect(contrastRatio(token('error'), token('error-surface'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token('error'), token('surface'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('white text is readable on a selected button colored --ink', () => {
    expect(contrastRatio('#ffffff', token('ink'))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
