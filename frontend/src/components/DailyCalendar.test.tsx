import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { describe, expect, it } from 'vitest';
import dailyExample from '../../../contract/examples/daily.response.json';
import type { Geometry } from '../api/types';
import { busiestDay, dayCells, dayName, daySentence, stepDay } from '../calendar/daily';
import { server } from '../mocks/server';
import { DailyCalendar } from './DailyCalendar';

const geometry: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [61, 51],
      [71, 51],
      [71, 55],
      [61, 55],
      [61, 51],
    ],
  ],
};

function renderDaily(years: number[] = [2010]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DailyCalendar geometry={geometry} years={years} />
    </QueryClientProvider>,
  );
}

const readout = () => screen.getByTestId('daily-readout');

describe('daily helpers', () => {
  const cells = dayCells(dailyExample.days);
  const indexOf = (date: string) => cells.findIndex((cell) => cell.data.date === date);

  it('places every day by its month and its day of the month', () => {
    expect(cells).toHaveLength(365);
    expect(cells[indexOf('2010-09-07')]).toMatchObject({ month: 9, day: 7 });
  });

  it('finds the busiest day, and none in a year without fires', () => {
    expect(dailyExample.days[busiestDay(dailyExample.days)].date).toBe('2010-05-03');
    expect(busiestDay([{ date: '2010-01-01', value: 0, preliminary: false }])).toBe(-1);
  });

  it('names a day and counts its detections', () => {
    expect(dayName('2010-09-07')).toBe('September 7, 2010');
    expect(daySentence({ date: '2010-09-07', value: 1, preliminary: false })).toBe(
      'September 7, 2010: 1 detection',
    );
    expect(daySentence({ date: '2026-11-13', value: 2.9, preliminary: true })).toBe(
      'November 13, 2026: 2.9 detections, preliminary',
    );
  });

  it('steps along the year and between months', () => {
    const from = indexOf('2010-03-31');
    expect(cells[stepDay(cells, from, 'ArrowRight')].data.date).toBe('2010-04-01');
    expect(cells[stepDay(cells, from, 'ArrowLeft')].data.date).toBe('2010-03-30');
    // February has no 31st: the nearest day is its last one.
    expect(cells[stepDay(cells, from, 'ArrowUp')].data.date).toBe('2010-02-28');
    expect(cells[stepDay(cells, from, 'ArrowDown')].data.date).toBe('2010-04-30');
    expect(cells[stepDay(cells, from, 'Home')].data.date).toBe('2010-03-01');
    expect(cells[stepDay(cells, indexOf('2010-03-05'), 'End')].data.date).toBe('2010-03-31');
    // The year ends: the focus stays where it is.
    expect(stepDay(cells, indexOf('2010-12-31'), 'ArrowRight')).toBe(indexOf('2010-12-31'));
    expect(stepDay(cells, indexOf('2010-01-10'), 'ArrowUp')).toBe(indexOf('2010-01-10'));
  });
});

describe('DailyCalendar (F14)', () => {
  it('draws a cell for every day of the year and reads out the busiest one', async () => {
    const { container } = renderDaily();

    await screen.findByRole('grid', { name: /^Fire detections by day, 2010/ });
    expect(container.querySelectorAll('[data-day]')).toHaveLength(365);
    expect(readout()).toHaveTextContent('Busiest day: May 3, 2010: 405.9 detections');
    expect(readout()).toHaveTextContent('12,877 in 2010');
    // Every day is said in words, so the value never depends on color alone.
    expect(screen.getByRole('gridcell', { name: 'May 3, 2010: 405.9 detections' })).toBeVisible();
  });

  it('reads out the day under the pointer and returns to the busiest one', async () => {
    const user = userEvent.setup();
    const { container } = renderDaily();
    const grid = await screen.findByRole('grid', { name: /^Fire detections by day/ });

    await user.hover(container.querySelector('[data-day="2010-01-01"]') as HTMLElement);
    expect(readout()).toHaveTextContent('January 1, 2010: 0 detections');
    expect(readout()).not.toHaveTextContent('Busiest day');

    await user.unhover(grid);
    expect(readout()).toHaveTextContent('Busiest day: May 3, 2010');
  });

  it('moves between days with the arrow keys', async () => {
    const user = userEvent.setup();
    const { container } = renderDaily();
    await screen.findByRole('grid', { name: /^Fire detections by day/ });

    // Tab reaches one cell: the busiest day.
    const start = container.querySelector('[tabindex="0"][data-day]') as HTMLElement;
    expect(start).toHaveAttribute('data-day', '2010-05-03');
    start.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAttribute('data-day', '2010-05-04');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAttribute('data-day', '2010-06-04');
    expect(readout()).toHaveTextContent('June 4, 2010');
  });

  it('says so when the year has no fires', async () => {
    server.use(
      http.post('*/api/v1/daily', () =>
        HttpResponse.json({
          year: 2010,
          unit: 'viirs_snpp_equivalent_detections',
          metric: 'count',
          days: [{ date: '2010-01-01', value: 0, preliminary: false }],
        }),
      ),
    );
    renderDaily();

    await screen.findByRole('grid', { name: /^Fire detections by day/ });
    expect(readout()).toHaveTextContent('No fires were detected in 2010.');
  });

  it('shows the error of the request in its own words', async () => {
    server.use(
      http.post('*/api/v1/daily', () =>
        HttpResponse.json(
          { error: { code: 'NO_DATA', message: 'Outside the coverage.' } },
          { status: 404 },
        ),
      ),
    );
    renderDaily();

    expect(await screen.findByRole('alert')).toHaveAttribute('data-code', 'NO_DATA');
  });
});
