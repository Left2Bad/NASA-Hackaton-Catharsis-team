import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import type { CalendarResponse } from '../api/types';
import { YearlyTotals } from './YearlyTotals';

const calendar = calendarJson as unknown as CalendarResponse;

const withoutTrend: CalendarResponse = {
  ...calendar,
  summary: { ...calendar.summary, trend_pct_per_decade: null, trend_line: null },
};

const readout = () => screen.getByTestId('yearly-readout');
const slider = () => screen.getByRole('slider', { name: 'Year on the chart of yearly totals' });

describe('YearlyTotals (F18)', () => {
  it('draws a bar for every year and hatches the incomplete ones', () => {
    const { container } = render(<YearlyTotals calendar={calendar} />);

    const bars = Array.from(container.querySelectorAll<SVGPathElement>('path[data-year]'));
    expect(bars).toHaveLength(calendar.yearly.length);
    const hatched = bars.filter((bar) => bar.style.fill.startsWith('url('));
    expect(hatched.map((bar) => bar.dataset.year)).toEqual(['2000', '2026']);
  });

  it('reads out the latest complete year by default', () => {
    render(<YearlyTotals calendar={calendar} />);

    expect(readout()).toHaveTextContent('2025');
    expect(readout()).toHaveTextContent('Total 3,583');
    expect(readout()).toHaveTextContent('Trend 3,699');
    expect(readout()).not.toHaveTextContent('incomplete year');
  });

  it('draws the trend line between the two points of the contract', () => {
    const { container } = render(<YearlyTotals calendar={calendar} />);

    expect(container.querySelectorAll('line[class*="trendLine"]')).toHaveLength(1);
    expect(
      screen.getByText(
        'The trend is a straight-line fit over the complete years, 2001 to 2025: −10 % per decade. Hatched years are incomplete and are left out of it.',
      ),
    ).toBeInTheDocument();
  });

  it('steps through the years with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<YearlyTotals calendar={calendar} />);

    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '2026');
    expect(slider()).toHaveAttribute('aria-valuetext', '2026: 3,660 detections, incomplete year');
    expect(readout()).toHaveTextContent('Total 3,660incomplete year');
    // The trend covers complete years only.
    expect(readout()).toHaveTextContent('Trend —');

    await user.keyboard('{Home}');
    expect(slider()).toHaveAttribute('aria-valuenow', '2000');
    await user.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuetext', '2001: 4,377 detections, trend 4,713');
  });

  it('gives the same numbers as a table', () => {
    render(<YearlyTotals calendar={calendar} />);

    const table = screen.getByRole('table', { name: 'Detections per year and the trend line' });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + calendar.yearly.length);
    expect(within(table).getByRole('row', { name: '2010 12,877 yes 4,333' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: '2026 3,660 no —' })).toBeInTheDocument();
  });

  it('shows the bars without a trend when there are too few complete years', () => {
    const { container } = render(<YearlyTotals calendar={withoutTrend} />);

    expect(container.querySelectorAll('path[data-year]')).toHaveLength(calendar.yearly.length);
    expect(container.querySelector('line[class*="trendLine"]')).toBeNull();
    expect(readout()).not.toHaveTextContent('Trend');
    expect(
      screen.getByText('There are too few complete years in this period to fit a trend.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Detections per year' })).toBeInTheDocument();
  });

  it('draws nothing without yearly data', () => {
    const { container } = render(<YearlyTotals calendar={{ ...calendar, yearly: [] }} />);

    expect(container).toBeEmptyDOMElement();
  });
});
