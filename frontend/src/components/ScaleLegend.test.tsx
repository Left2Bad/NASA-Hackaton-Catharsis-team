import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScaleLegend } from './ScaleLegend';

const COLORS = ['#111', '#222', '#333', '#444', '#555', '#666', '#777'];
const BOUNDARIES = ['−60 %', '−33 %', '−10 %', '+10 %', '+50 %', '+150 %'];

describe('ScaleLegend', () => {
  it('gives the scale room for one label per class', () => {
    render(<ScaleLegend title="Difference" colors={COLORS} boundaries={BOUNDARIES} />);

    // The CSS turns the class count into the smallest width of the scale.
    const scale = screen.getByText('−60 %').parentElement?.parentElement as HTMLElement;
    expect(scale.style.getPropertyValue('--classes')).toBe('7');
  });

  it('shows a note only when one is given', () => {
    const { rerender } = render(
      <ScaleLegend title="Difference" colors={COLORS} boundaries={BOUNDARIES} />,
    );
    expect(screen.queryByText('How to read it.')).toBeNull();

    rerender(
      <ScaleLegend
        title="Difference"
        colors={COLORS}
        boundaries={BOUNDARIES}
        note="How to read it."
      />,
    );
    expect(screen.getByText('How to read it.')).toBeInTheDocument();
  });
});
