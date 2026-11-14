import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import type { CalendarResponse } from '../api/types';
import { SummaryFacts } from './SummaryFacts';

const calendar = calendarJson as unknown as CalendarResponse;

const withSummary = (summary: Partial<CalendarResponse['summary']>): CalendarResponse => ({
  ...calendar,
  summary: { ...calendar.summary, ...summary },
});

/** The texts of one fact: its value and, when present, the detail line under it. */
const factTexts = (label: string) => {
  const group = screen.getByText(label).parentElement as HTMLElement;
  return Array.from(group.querySelectorAll('dd')).map((item) => item.textContent);
};

describe('SummaryFacts (F16)', () => {
  it('shows the four numbers of the example', () => {
    render(<SummaryFacts calendar={calendar} />);

    expect(factTexts('Most active year')).toEqual(['2010', '12,877 detections']);
    expect(factTexts('Peak month')).toEqual(['September', 'median 779.4']);
    expect(factTexts('Total detections')).toEqual(['108,872', '2000 to 2026']);
    expect(factTexts('Trend')).toEqual(['Falling', '−10 % per decade']);
    expect(screen.queryByText(/No fires were detected/)).toBeNull();
  });

  it('draws an arrow next to the trend word, and only there', () => {
    const { container } = render(<SummaryFacts calendar={calendar} />);

    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('[data-fact="trend"] svg')).not.toBeNull();
  });

  it('has no arrow when the trend is unknown', () => {
    const { container } = render(
      <SummaryFacts calendar={withSummary({ trend_pct_per_decade: null, trend_line: null })} />,
    );

    expect(factTexts('Trend')).toEqual(['—', 'too few complete years']);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('says so when the area has no fires', () => {
    render(
      <SummaryFacts
        calendar={withSummary({
          peak_year: null,
          peak_month: null,
          total: 0,
          trend_pct_per_decade: null,
          trend_line: null,
        })}
      />,
    );

    expect(factTexts('Most active year')).toEqual(['—']);
    expect(
      screen.getByText('No fires were detected in this area in the chosen period.'),
    ).toBeInTheDocument();
  });
});
