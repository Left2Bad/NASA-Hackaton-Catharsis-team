import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import metaJson from '../../../contract/examples/meta.json';
import type { CalendarResponse, Meta, MonthValue } from '../api/types';
import { describeBaseline, describeMonth, monthSentence } from '../calendar/describe';
import { BurnCalendar } from './BurnCalendar';

const calendar = calendarJson as unknown as CalendarResponse;
const meta = metaJson as unknown as Meta;

const monthOf = (year: number, month: number) =>
  calendar.months.find((m) => m.year === year && m.month === month) as MonthValue;

function renderCalendar() {
  const view = render(<BurnCalendar calendar={calendar} sources={meta.sources} />);
  const cell = (id: string) => view.container.querySelector(`[data-month="${id}"]`) as HTMLElement;
  return { ...view, cell };
}

describe('BurnCalendar', () => {
  it('draws a row for every year and a cell for every month of the record (F7)', () => {
    const { container } = renderCalendar();

    const grid = screen.getByRole('grid', { name: /^Fire detections by month, 2000 to 2026/ });
    // One header row, one row per year and the median row.
    expect(within(grid).getAllByRole('row')).toHaveLength(1 + 27 + 1);
    expect(container.querySelectorAll('[data-month]')).toHaveLength(calendar.months.length);
  });

  it('shows the yearly totals and marks incomplete years (F8)', () => {
    renderCalendar();

    const year2010 = calendar.yearly.find((y) => y.year === 2010);
    expect(
      screen.getByRole('gridcell', {
        name: `2010 total: ${Math.round(year2010?.total ?? 0).toLocaleString('en-US')}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: /^2026 total: .*incomplete year$/ }),
    ).toBeInTheDocument();
  });

  it('shows the long-term median of every month (F8)', () => {
    const { container } = renderCalendar();

    expect(container.querySelectorAll('[data-median]')).toHaveLength(12);
    const august = calendar.monthly_baseline[7];
    expect(
      screen.getByRole('gridcell', {
        name: `August median: ${august.median.toLocaleString('en-US')}`,
      }),
    ).toBeInTheDocument();
  });

  it('opens a tooltip with the exact numbers when a cell is focused (F9)', () => {
    const { cell } = renderCalendar();

    fireEvent.focus(cell('2010-08'));

    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(within(tip).getByText('August 2010')).toBeInTheDocument();
    expect(within(tip).getByText('2,513.3')).toBeInTheDocument();
    expect(within(tip).getByText('2,060.9 to 3,041.1')).toBeInTheDocument();
    expect(within(tip).getByText('Median for August')).toBeInTheDocument();
    expect(within(tip).getByText('+272.9 % vs. median')).toBeInTheDocument();
    expect(within(tip).getByText('MODIS Terra + Aqua')).toBeInTheDocument();
  });

  it('opens the same tooltip on hover and closes it when the pointer leaves', async () => {
    const user = userEvent.setup();
    const { cell } = renderCalendar();

    await user.hover(cell('2015-08'));
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('August 2015');

    await user.unhover(cell('2015-08'));
    await user.hover(document.body);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('explains the median of a month on hover', async () => {
    const user = userEvent.setup();
    const { container } = renderCalendar();

    await user.hover(container.querySelector('[data-median="8"]') as HTMLElement);
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).toHaveTextContent('August, typical');
    expect(tip).toHaveTextContent('From 25 baseline years');
  });

  it('gives every cell a spoken description, so the value does not depend on color', () => {
    const { cell } = renderCalendar();

    expect(cell('2010-08')).toHaveAttribute(
      'aria-label',
      'August 2010: 2,513.3 detections, +272.9 % against the median, high',
    );
    expect(cell('2026-11').getAttribute('aria-label')).toMatch(/partial month, preliminary$/);
  });

  it('moves between cells with the arrow keys and keeps one cell in the tab order', async () => {
    const user = userEvent.setup();
    const { container, cell } = renderCalendar();

    // The newest month is the one Tab reaches first.
    expect(container.querySelectorAll('[data-month][tabindex="0"]')).toHaveLength(1);
    expect(cell('2026-11')).toHaveAttribute('tabindex', '0');

    cell('2010-08').focus();
    await user.keyboard('{ArrowRight}');
    expect(cell('2010-09')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(cell('2011-09')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowLeft}');
    expect(cell('2010-08')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(cell('2010-01')).toHaveFocus();
    await user.keyboard('{End}');
    expect(cell('2010-12')).toHaveFocus();
    expect(container.querySelectorAll('[data-month][tabindex="0"]')).toHaveLength(1);
  });

  it('stops at the edge of the record instead of landing on a month without data', async () => {
    const user = userEvent.setup();
    const { cell } = renderCalendar();

    // The record starts in November 2000: there is nothing to the left of it.
    cell('2000-11').focus();
    await user.keyboard('{ArrowLeft}');
    expect(cell('2000-11')).toHaveFocus();
  });

  it('closes the tooltip on Escape', async () => {
    const user = userEvent.setup();
    const { cell } = renderCalendar();

    cell('2010-08').focus();
    expect(await screen.findByRole('tooltip', { hidden: true })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('marks preliminary months on the cell itself', () => {
    const { cell } = renderCalendar();

    expect(cell('2026-07')).toHaveAttribute('data-preliminary', 'true');
    expect(cell('2026-06')).not.toHaveAttribute('data-preliminary');
  });
});

describe('cell descriptions', () => {
  it('leaves out the range for the reference sensor, which is not converted', () => {
    const labels = describeMonth(monthOf(2015, 8)).lines.map((line) => line.label);
    expect(labels).not.toContain('Likely range');
    expect(labels).toContain('Lead sensor');
  });

  it('flags a preliminary, partial month and does not compare it with the median', () => {
    const description = describeMonth(monthOf(2026, 11));
    expect(description.lines.find((line) => line.label === 'Difference')?.value).toBe(
      'Partial month, not compared',
    );
    expect(description.notes).toEqual([
      'Preliminary: near-real-time data, to be revised.',
      'The month is not over yet.',
    ]);
  });

  it('flags a sensor outage and names the backup satellite', () => {
    const description = describeMonth(monthOf(2024, 7));
    expect(description.notes).toContain('Sensor outage: the value comes from a backup satellite.');
    expect(description.lines.find((line) => line.label === 'Lead sensor')?.value).toBe(
      'VIIRS NOAA-20',
    );
  });

  it('speaks of detections instead of a percentage when the median is zero', () => {
    const month: MonthValue = { ...monthOf(2015, 8), median: 0, anomaly_pct: null, value: 12 };
    expect(describeMonth(month).lines.find((line) => line.label === 'Difference')?.value).toBe(
      '12 above a median of zero',
    );
    expect(monthSentence(month)).toBe('August 2015: 12 detections, normal');
  });

  it('describes the usual range of a calendar month', () => {
    const description = describeBaseline(calendar.monthly_baseline[7]);
    expect(description.title).toBe('August, typical');
    expect(description.lines.map((line) => line.label)).toEqual([
      'Median',
      'Usual range',
      'Highest',
    ]);
  });
});
