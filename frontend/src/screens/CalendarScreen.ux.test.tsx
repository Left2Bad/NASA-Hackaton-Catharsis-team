import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import calendarExample from '../../../contract/examples/calendar.response.json';
import currentExample from '../../../contract/examples/current.response.json';
import metaExample from '../../../contract/examples/meta.json';
import pointsExample from '../../../contract/examples/points.response.json';
import type { CurrentResponse, Meta, PointsResponse } from '../api/types';
import { hotspotsFileName, monthDates, monthFileName } from '../export/files';
import { formatNumber } from '../labels';
import { server } from '../mocks/server';
import { spotsSummary } from '../map/spots';
import { nowHeadline } from '../now/describe';
import { writeSearch } from '../state/link';
import { CalendarScreen } from './CalendarScreen';

// How the panel is laid out for a reader who comes with a question: the answer first,
// links to the sections, and the words a specialist needs to trust the numbers.

vi.mock('../components/AreaMap', () => ({
  AreaMap: () => <div data-testid="map" />,
}));

const saved = vi.hoisted(() => ({ files: [] as { name: string; type: string }[] }));
vi.mock('../export/files', async (original) => ({
  ...(await original<typeof import('../export/files')>()),
  saveBlob: (blob: Blob, name: string) => {
    saved.files.push({ name, type: blob.type });
  },
}));

const meta = metaExample as unknown as Meta;
const current = currentExample as unknown as CurrentResponse;

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarScreen />
    </QueryClientProvider>,
  );
}

async function openArea(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
  await screen.findByRole('grid', { name: /^Fire detections by month, / });
}

afterEach(() => {
  window.location.hash = '';
  writeSearch('');
  saved.files.length = 0;
});

describe('numbers', () => {
  it('drops the decimal from 100 up and keeps it below', () => {
    expect(formatNumber(16430.3)).toBe('16,430');
    expect(formatNumber(99.94)).toBe('99.9');
    expect(formatNumber(100.4)).toBe('100');
    expect(formatNumber(4.25)).toBe('4.3');
    expect(formatNumber(-3259.6)).toBe('-3,260');
  });
});

describe('the start screen', () => {
  it('says how to begin in three steps and marks the buttons as examples', async () => {
    renderScreen();

    const steps = await screen.findAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('strong')?.textContent)).toEqual([
      'Choose an area.',
      'Read its calendar.',
      'Compare and export.',
    ]);
    expect(screen.getByRole('group', { name: 'Example areas' })).toHaveTextContent(/^Examples/);
  });
});

describe('the answer first', () => {
  it('puts the current month in one line under the header, before the calendar', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);

    const headline = await screen.findByTestId('now-headline');
    expect(headline).toHaveTextContent('Now, November 1 to 13, 2026');
    expect(within(headline).getByText('Above normal', { selector: 'strong' })).toBeInTheDocument();
    expect(headline).toHaveTextContent(nowHeadline(current).detail);
    expect(headline).toHaveTextContent(/against the median of the same days/);

    const grid = screen.getByRole('grid', { name: /^Fire detections by month/ });
    expect(headline.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no level to name where the month cannot be placed on the levels', () => {
    const headline = nowHeadline({ ...current, category: null, anomaly_pct: null, value: 0 });
    expect(headline.level).toBeNull();
    expect(headline.color).toBeNull();
    expect(headline.detail).toBe('0 detections, No detections, the same as the median');
  });

  it('shows one error, not two, when the server cannot answer for the area', async () => {
    const user = userEvent.setup();
    const refuse = () =>
      HttpResponse.json(
        { error: { code: 'NO_DATA', message: 'Outside the coverage.' } },
        { status: 404 },
      );
    server.use(http.post('*/api/v1/calendar', refuse), http.post('*/api/v1/current', refuse));
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    const panel = screen.getByRole('region', { name: 'Fire activity' });
    await within(panel).findByRole('alert');
    await waitFor(() => expect(within(panel).getAllByRole('alert')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Now' })).toBeNull();
    expect(screen.queryByTestId('now-headline')).toBeNull();
  });
});

describe('finding a section', () => {
  it('offers a link to every section of the panel, in their order on the page', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);

    const nav = screen.getByRole('navigation', { name: 'Sections of the panel' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(['Calendar', 'Summary', 'Now', 'Season', 'Years', 'Days', 'Downloads']);

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Burn calendar',
      'Summary',
      'Now',
      'Season profile',
      'Yearly totals',
      'Daily calendar',
      'Downloads',
    ]);
  });

  it('scrolls to the section that is asked for', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };

    const nav = screen.getByRole('navigation', { name: 'Sections of the panel' });
    await user.click(within(nav).getByRole('button', { name: 'Downloads' }));

    expect(scrolled).toEqual(['downloads-heading']);
  });

  it('has nothing to link to before an area is chosen', async () => {
    renderScreen();
    await screen.findByRole('group', { name: 'Example areas' });

    expect(screen.queryByRole('navigation', { name: 'Sections of the panel' })).toBeNull();
  });
});

describe('what is counted', () => {
  it('names the unit, what is left out and the baseline years', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);

    const about = screen.getByText('What is counted').closest('details') as HTMLElement;
    expect(about).toHaveTextContent(/VIIRS Suomi NPP equivalents/);
    expect(about).toHaveTextContent(/Low-confidence detections and static sources/);
    expect(about).toHaveTextContent(
      `use ${calendarExample.baseline.start_year} to ${calendarExample.baseline.end_year} as the baseline`,
    );
    expect(within(about).getByRole('link', { name: 'How the record is made' })).toHaveAttribute(
      'href',
      '#/method',
    );
  });

  it('says in the "Now" section what the numbers are measured against', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);

    const now = await screen.findByRole('region', { name: 'Now' });
    const years = current.baseline_same_days.n_years;
    expect(await within(now).findByText(`${years} baseline years`)).toBeInTheDocument();
    expect(within(now).getByText('VIIRS-equivalent')).toBeInTheDocument();
    expect(
      within(now).getByText(`above ${Math.round(current.percentile ?? 0)} % of those years`),
    ).toBeInTheDocument();
    expect(within(now).getByText(/^Levels are percentiles of the same days/)).toHaveTextContent(
      'normal is P25 to P75, above normal up to P90',
    );
  });
});

describe('dates of the hot spot file', () => {
  /** Records the bodies of hot spot exports. */
  function recordExports(): Record<string, unknown>[] {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/v1/export/points.csv', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return new HttpResponse('latitude,longitude\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      }),
    );
    return bodies;
  }

  it('sends the dates that were typed and names the file after them', async () => {
    const user = userEvent.setup();
    const bodies = recordExports();
    renderScreen();
    await openArea(user);

    const downloads = screen.getByRole('region', { name: 'Downloads' });
    const dates = within(downloads).getByRole('group', { name: 'Dates of the hot spot file' });
    await user.clear(within(dates).getByLabelText('From'));
    await user.type(within(dates).getByLabelText('From'), '2020-09-01');
    await user.clear(within(dates).getByLabelText('to'));
    await user.type(within(dates).getByLabelText('to'), '2020-09-30');
    await user.click(within(downloads).getByRole('button', { name: 'Hot spots (CSV)' }));

    await waitFor(() => expect(saved.files).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ start_date: '2020-09-01', end_date: '2020-09-30' });
    expect(saved.files[0].name).toBe('firms-hotspots_kz-steppe_2020-09-01_2020-09-30.csv');

    // One click returns to the whole period.
    await user.click(within(dates).getByRole('button', { name: 'Whole period' }));
    expect(within(dates).getByLabelText('From')).toHaveValue(meta.first_date);
    expect(within(dates).queryByRole('button', { name: 'Whole period' })).toBeNull();
  });

  it('does not send dates that run backwards', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);

    const downloads = screen.getByRole('region', { name: 'Downloads' });
    const dates = within(downloads).getByRole('group', { name: 'Dates of the hot spot file' });
    await user.clear(within(dates).getByLabelText('to'));
    await user.type(within(dates).getByLabelText('to'), '2000-01-01');

    expect(within(dates).getByRole('alert')).toHaveTextContent(
      'The first date must not be after the last one.',
    );
    expect(within(downloads).getByRole('button', { name: 'Hot spots (CSV)' })).toBeDisabled();
    expect(within(downloads).getByRole('button', { name: 'Monthly table (CSV)' })).toBeEnabled();
  });

  it('names files by years, by typed dates and by month', () => {
    const scope = {
      geometry: meta.presets[0].geometry,
      presetId: 'kz-steppe',
      startYear: 2010,
      endYear: 2012,
    };
    const whole = { start_date: '2010-01-01', end_date: '2012-12-31' };
    expect(hotspotsFileName(scope, whole, meta)).toBe('firms-hotspots_kz-steppe_2010-2012.csv');
    expect(hotspotsFileName(scope, { ...whole, end_date: '2010-03-31' }, meta)).toBe(
      'firms-hotspots_kz-steppe_2010-01-01_2010-03-31.csv',
    );
    expect(monthFileName(scope, 2020, 9)).toBe('firms-hotspots_kz-steppe_2020-09.csv');
  });

  it('gives the first and the last day of a month, inside the record', () => {
    const record = { first_date: '2000-11-01', last_date: '2026-11-13' };
    expect(monthDates(2020, 2, record)).toEqual({
      start_date: '2020-02-01',
      end_date: '2020-02-29',
    });
    expect(monthDates(2026, 11, record)).toEqual({
      start_date: '2026-11-01',
      end_date: '2026-11-13',
    });
  });
});

describe('the hot spots of a month as a file', () => {
  it('downloads every detection of the month that is on the map', async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/v1/export/points.csv', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return new HttpResponse('latitude,longitude\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      }),
    );
    const { container } = renderScreen();
    await openArea(user);

    await user.click(container.querySelector('[data-month="2020-09"]') as HTMLElement);
    await user.click(await screen.findByRole('button', { name: 'Download CSV of these months' }));

    await waitFor(() => expect(saved.files).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ start_date: '2020-09-01', end_date: '2020-09-30' });
    expect(saved.files[0].name).toBe('firms-hotspots_kz-steppe_2020-09.csv');
  });

  it('offers no file for a month without hot spots', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/points', () =>
        HttpResponse.json({ type: 'FeatureCollection', features: [], total: 0, truncated: false }),
      ),
    );
    const { container } = renderScreen();
    await openArea(user);

    await user.click(container.querySelector('[data-month="2020-01"]') as HTMLElement);

    expect(await screen.findByText('No hot spots in January 2020.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download CSV of these months' })).toBeNull();
  });

  it('says how many of the hot spots are drawn', () => {
    const points = pointsExample as unknown as PointsResponse;
    expect(
      spotsSummary({ ...points, total: 1, features: points.features.slice(0, 1) }, 'August 2020'),
    ).toBe('August 2020: 1 hot spot on the map, all sensors.');
    expect(spotsSummary({ ...points, total: 165893, truncated: true }, 'September 2020')).toBe(
      `September 2020: the ${points.features.length} strongest of 165,893 hot spots on the map, all sensors.`,
    );
  });
});
