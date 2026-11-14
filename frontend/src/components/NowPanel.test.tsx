import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import currentJson from '../../../contract/examples/current.response.json';
import type { CurrentResponse } from '../api/types';
import { NowPanel } from './NowPanel';

const current = currentJson as unknown as CurrentResponse;

const withFields = (fields: Partial<CurrentResponse>): CurrentResponse => ({
  ...current,
  ...fields,
});

describe('NowPanel (F15)', () => {
  it('answers with the level, the difference and the numbers behind them', () => {
    render(<NowPanel current={current} />);

    expect(screen.getByText('November 1 to 13, 2026')).toBeInTheDocument();
    expect(screen.getByText('Above normal', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('+48.6 % against the median of the same days')).toBeInTheDocument();

    const fact = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(fact('Detections so far')).toHaveTextContent('25.7');
    expect(fact('Median of the same days')).toHaveTextContent('17.3');
    expect(fact('Percentile')).toHaveTextContent('84');
  });

  it('lists the five levels with their ranges and marks the current one', () => {
    render(<NowPanel current={current} />);

    const levels = within(
      screen.getByRole('list', { name: 'Levels for these days of the month' }),
    ).getAllByRole('listitem');
    expect(levels.map((item) => item.textContent)).toEqual([
      'Below normalbelow 9.5',
      'Normal9.5 to 25.1',
      'Above normal25.1 to 36.3',
      'High36.3 to 58.8',
      'Recordabove 58.8',
    ]);
    expect(levels.filter((item) => item.getAttribute('aria-current') === 'true')).toEqual([
      levels[2],
    ]);
  });

  it('says where the numbers come from and that they are preliminary', () => {
    render(<NowPanel current={current} />);

    expect(
      screen.getByText(
        'Compared with the same days of the month in 25 baseline years. Lead sensor: VIIRS NOAA-20.',
      ),
    ).toBeInTheDocument();
    // The preliminary flag and the PRELIMINARY_DATA warning say the same thing once.
    expect(screen.getAllByText(/near-real-time data/)).toHaveLength(1);
  });

  it('shows other warnings of the response', () => {
    render(
      <NowPanel
        current={withFields({
          preliminary: false,
          warnings: [{ code: 'AREA_SMALL', message: 'Server text.' }],
        })}
      />,
    );

    expect(
      screen.getByText('The area covers only a few grid cells, so the series is noisy.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/near-real-time data/)).toBeNull();
  });

  it('copes with an area that has no baseline to compare with', () => {
    render(
      <NowPanel
        current={withFields({
          value: 0,
          anomaly_pct: null,
          percentile: null,
          category: null,
          baseline_same_days: { median: 0, p25: 0, p75: 0, p90: 0, max: 0, n_years: 25 },
          cumulative: current.cumulative.map((day) => ({ day: day.day, value: 0, median: 0 })),
        })}
      />,
    );

    expect(screen.getByText('No detections, the same as the median')).toBeInTheDocument();
    expect(screen.getByText('Percentile', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      '—',
    );
    expect(screen.queryByText('Above normal', { selector: 'strong' })).toBeNull();
    // Five levels of "0 to 0" would say nothing: a sentence stands in for the scale.
    expect(screen.queryByRole('list', { name: 'Levels for these days of the month' })).toBeNull();
    expect(
      screen.getByText(
        'No fires were detected on these days in any of the 25 baseline years, so there are no levels to compare with.',
      ),
    ).toBeInTheDocument();
  });

  it('leaves out levels that collapse to a single value', () => {
    // What the real API returns for an area with the same count every year.
    render(
      <NowPanel
        current={withFields({
          value: 336,
          anomaly_pct: 50,
          percentile: 100,
          category: 'record',
          baseline_same_days: { median: 224, p25: 112, p75: 224, p90: 224, max: 224, n_years: 25 },
        })}
      />,
    );

    const levels = within(
      screen.getByRole('list', { name: 'Levels for these days of the month' }),
    ).getAllByRole('listitem');
    expect(levels.map((item) => item.textContent)).toEqual([
      'Below normalbelow 112',
      'Normal112 to 224',
      'Recordabove 224',
    ]);
  });
});

describe('cumulative chart of the Now panel', () => {
  it('reads out the latest day by default', () => {
    render(<NowPanel current={current} />);

    const readout = screen.getByTestId('cumulative-readout');
    expect(readout).toHaveTextContent('November 13');
    expect(readout).toHaveTextContent('This month 25.7');
    expect(readout).toHaveTextContent('Median of the same days 17.3');
  });

  it('steps through the days with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<NowPanel current={current} />);

    const slider = screen.getByRole('slider', { name: 'Day of the month on the chart' });
    expect(slider).toHaveAttribute('aria-valuenow', '13');

    slider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '12');
    expect(slider).toHaveAttribute('aria-valuetext', 'November 12: 22.4 so far, median 16');
    expect(screen.getByTestId('cumulative-readout')).toHaveTextContent('This month 22.4');

    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    // The first day is the edge: one more step back stays there.
    await user.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '1');

    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '13');
  });

  it('returns to the latest day when focus leaves the chart', async () => {
    const user = userEvent.setup();
    render(<NowPanel current={current} />);

    const slider = screen.getByRole('slider', { name: 'Day of the month on the chart' });
    slider.focus();
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '1');

    fireEvent.blur(slider);
    expect(slider).toHaveAttribute('aria-valuenow', '13');
  });

  it('offers the same numbers as a table', () => {
    render(<NowPanel current={current} />);

    const table = screen.getByRole('table', {
      name: 'Detections accumulated since the start of the month, by day',
    });
    // One header row and one row per day.
    expect(within(table).getAllByRole('row')).toHaveLength(1 + current.cumulative.length);
    expect(within(table).getByRole('row', { name: 'November 8 14.8 10.7' })).toBeInTheDocument();
  });
});
