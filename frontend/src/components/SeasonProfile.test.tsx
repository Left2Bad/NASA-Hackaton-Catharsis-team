import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import type { CalendarResponse } from '../api/types';
import { SeasonProfile } from './SeasonProfile';

const calendar = calendarJson as unknown as CalendarResponse;

const readout = () => screen.getByTestId('season-readout');
const yearSelect = () => screen.getByLabelText('Year over the typical season');
const slider = () => screen.getByRole('slider', { name: 'Month on the season profile' });

describe('SeasonProfile (F17)', () => {
  it('starts with the newest year and reads out its busiest month', () => {
    render(<SeasonProfile calendar={calendar} />);

    expect(yearSelect()).toHaveValue('2026');
    expect(readout()).toHaveTextContent('May');
    expect(readout()).toHaveTextContent('2026 1,350');
    expect(readout()).toHaveTextContent('Median 724');
    expect(readout()).toHaveTextContent('Usual range 419 to 1,352');
  });

  it('offers every year of the response, newest first', () => {
    render(<SeasonProfile calendar={calendar} />);

    const options = within(yearSelect())
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toHaveLength(27);
    expect(options[0]).toBe('2026');
    expect(options[26]).toBe('2000');
  });

  it('lays another year over the profile when it is chosen', async () => {
    const user = userEvent.setup();
    render(<SeasonProfile calendar={calendar} />);

    await user.selectOptions(yearSelect(), '2010');

    expect(readout()).toHaveTextContent('May');
    expect(readout()).toHaveTextContent('2010 4,121');
    expect(
      screen.getByRole('table', {
        name: 'Season profile by month: 2010 against the median and the usual range',
      }),
    ).toBeInTheDocument();
  });

  it('steps through the months with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<SeasonProfile calendar={calendar} />);

    slider().focus();
    await user.keyboard('{End}');
    expect(slider()).toHaveAttribute('aria-valuenow', '12');
    // December 2026 has not happened yet.
    expect(readout()).toHaveTextContent('2026 no data');
    expect(slider()).toHaveAttribute(
      'aria-valuetext',
      'December 2026: no data, median 6.2, usual range 3 to 11.1',
    );

    await user.keyboard('{ArrowLeft}');
    expect(slider()).toHaveAttribute('aria-valuenow', '11');
    expect(readout()).toHaveTextContent('2026 37.6month not over yet');
    expect(slider().getAttribute('aria-valuetext')).toContain('month not over yet');

    await user.keyboard('{Home}');
    expect(readout()).toHaveTextContent('January');
  });

  it('marks the month that is not over with a ring on the plot', () => {
    const { container } = render(<SeasonProfile calendar={calendar} />);

    // November 2026 is the only partial month of the example.
    expect(container.querySelectorAll('circle[class*="hollowDot"]')).toHaveLength(1);
  });

  it('gives the same numbers as a table', () => {
    render(<SeasonProfile calendar={calendar} />);

    const table = screen.getByRole('table', {
      name: 'Season profile by month: 2026 against the median and the usual range',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 12);
    expect(
      within(table).getByRole('row', { name: 'September 902 779 395 1,322' }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('row', { name: 'December no data 6.2 3 11.1' }),
    ).toBeInTheDocument();
  });

  it('falls back to the newest year when the period no longer holds the chosen one', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SeasonProfile calendar={calendar} />);
    await user.selectOptions(yearSelect(), '2010');

    const later: CalendarResponse = {
      ...calendar,
      months: calendar.months.filter((month) => month.year >= 2020),
    };
    rerender(<SeasonProfile calendar={later} />);

    expect(yearSelect()).toHaveValue('2026');
    expect(within(yearSelect()).getAllByRole('option')).toHaveLength(7);
  });

  it('names the baseline behind the usual range', () => {
    render(<SeasonProfile calendar={calendar} />);

    expect(
      screen.getByText('The usual range holds 8 years out of 10 of the baseline, 2001 to 2025.'),
    ).toBeInTheDocument();
  });
});
