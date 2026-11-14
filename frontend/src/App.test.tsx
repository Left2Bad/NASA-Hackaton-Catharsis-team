import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import calendarExample from '../../contract/examples/calendar.response.json';
import currentExample from '../../contract/examples/current.response.json';
import metaExample from '../../contract/examples/meta.json';
import validationExample from '../../contract/examples/method_validation.response.json';
import App from './App';
import { server } from './mocks/server';
import { writeSearch } from './state/link';
import { VISIONS } from './theme/cvd';

// The real map needs WebGL. This stand-in exposes what the screen relies on:
// the map reports a drawn area, and the map reports that the area was cleared.
vi.mock('./components/AreaMap', () => {
  const triangle = [
    [10, 20],
    [12, 20],
    [12, 22],
    [10, 20],
  ];
  // About 100 million km²: far above the 3 million km² limit of the example dataset.
  const continentSized = [
    [-60, -40],
    [60, -40],
    [60, 40],
    [-60, 40],
    [-60, -40],
  ];
  return {
    AreaMap: ({ onChange }: { onChange: (geometry: unknown) => void }) => (
      <div>
        <button
          type="button"
          onClick={() => onChange({ type: 'Polygon', coordinates: [triangle] })}
        >
          Draw test area
        </button>
        <button
          type="button"
          onClick={() => onChange({ type: 'Polygon', coordinates: [continentSized] })}
        >
          Draw huge area
        </button>
        <button type="button" onClick={() => onChange(null)}>
          Clear test area
        </button>
      </div>
    ),
  };
});

const FIRST_YEAR = Number(metaExample.first_date.slice(0, 4));
const LAST_YEAR = Number(metaExample.last_date.slice(0, 4));

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

/** Records the bodies of calendar requests while answering them like the usual mock. */
function recordCalendarRequests(): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post('*/api/v1/calendar', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(calendarExample);
    }),
  );
  return bodies;
}

afterEach(() => {
  window.location.hash = '';
  // The calendar remembers its state for the link back; each test starts without one.
  writeSearch('');
});

describe('main screen on mocks', () => {
  it('starts with a prompt and no area selected', async () => {
    renderApp();

    const presets = await screen.findByRole('group', { name: 'Example areas' });
    expect(within(presets).getAllByRole('button')).toHaveLength(metaExample.presets.length);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Choose an area to see its fire calendar' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: /^Fire detections by month/ })).toBeNull();
  });

  it('loads the calendar for an example area', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Northern Kazakhstan' }),
    ).toBeInTheDocument();
    await screen.findByRole('grid', { name: /^Fire detections by month/ });
    expect(container.querySelectorAll('[data-month]')).toHaveLength(calendarExample.months.length);

    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(
      within(summary).getByText(String(calendarExample.summary.peak_year)),
    ).toBeInTheDocument();
  });

  it('marks the seam where the record passes from MODIS to VIIRS', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    await screen.findByRole('grid', { name: /^Fire detections by month/ });
    const seam = (month: string) =>
      container.querySelector(`[data-month="${month}"]`)?.getAttribute('data-seam') ?? '';

    // January 2012 is still led by MODIS; Suomi NPP takes over in February.
    expect(seam('2012-01')).not.toContain('left');
    expect(seam('2012-02')).toContain('left');
    expect(seam('2012-03')).not.toContain('left');
    // February 2012 and February 2011 were led by different sensors.
    expect(seam('2012-02')).toContain('bottom');
  });

  it('sends a drawn area to the API as GeoJSON, with the whole record as the period', async () => {
    const user = userEvent.setup();
    const bodies = recordCalendarRequests();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Draw test area' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Custom area' }),
    ).toBeInTheDocument();
    await screen.findByRole('grid', { name: /^Fire detections by month/ });
    expect(bodies).toEqual([
      {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [10, 20],
              [12, 20],
              [12, 22],
              [10, 20],
            ],
          ],
        },
        start_year: FIRST_YEAR,
        end_year: LAST_YEAR,
      },
    ]);
    // A drawn shape is not one of the examples.
    for (const button of within(screen.getByRole('group', { name: 'Example areas' })).getAllByRole(
      'button',
    )) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('returns to the prompt when the area is cleared', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Southern Amazon' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Southern Amazon' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Southern Amazon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Clear test area' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Choose an area to see its fire calendar' }),
    ).toBeInTheDocument();
  });

  it('explains an API error in its own words', async () => {
    server.use(
      http.get('*/api/v1/meta', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'Service is temporarily unavailable.' } },
          { status: 500 },
        ),
      ),
    );
    renderApp();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'INTERNAL');
    expect(alert).toHaveTextContent('The server could not answer. Try again in a moment.');
  });
});

describe('period (F4)', () => {
  it('offers the whole record by default', async () => {
    renderApp();

    const period = await screen.findByRole('group', { name: 'Period' });
    expect(within(period).getByLabelText('From')).toHaveValue(String(FIRST_YEAR));
    expect(within(period).getByLabelText('to')).toHaveValue(String(LAST_YEAR));
  });

  it('requests the calendar again for the chosen years and shows only those years', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    await screen.findByRole('grid', { name: /^Fire detections by month/ });

    const period = screen.getByRole('group', { name: 'Period' });
    await user.selectOptions(within(period).getByLabelText('From'), '2010');
    await user.selectOptions(within(period).getByLabelText('to'), '2012');

    await screen.findByRole('grid', {
      name: 'Fire detections by month, 2010 to 2012. Darker cells mean more detections.',
    });
    expect(container.querySelectorAll('[data-month]')).toHaveLength(36);
  });

  it('never lets "from" pass "to"', async () => {
    const user = userEvent.setup();
    renderApp();

    const period = await screen.findByRole('group', { name: 'Period' });
    await user.selectOptions(within(period).getByLabelText('to'), '2005');

    const fromYears = within(within(period).getByLabelText('From'))
      .getAllByRole('option')
      .map((option) => Number(option.textContent));
    expect(Math.max(...fromYears)).toBe(2005);
  });
});

describe('area size (F5)', () => {
  it('refuses an area above the limit without asking the API', async () => {
    const user = userEvent.setup();
    const bodies = recordCalendarRequests();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Draw huge area' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/The limit is 3,000,000 km²/);
    expect(alert).toHaveTextContent(/Draw or enter a smaller area/);
    expect(screen.queryByText('Loading the calendar…')).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it('warns that a small area gives a noisy series', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Enter coordinates' }));
    const form = screen.getByRole('form', { name: 'Area by coordinates' });
    await user.type(within(form).getByLabelText('West'), '67');
    await user.type(within(form).getByLabelText('South'), '53');
    await user.type(within(form).getByLabelText('East'), '67.2');
    await user.type(within(form).getByLabelText('North'), '53.2');
    await user.click(within(form).getByRole('button', { name: 'Show area' }));

    expect(
      await screen.findByText('The area covers only a few grid cells, so the series is noisy.'),
    ).toBeInTheDocument();
  });
});

describe('now panel (F15)', () => {
  /** Records the bodies of /current requests while answering them with the example. */
  function recordCurrentRequests(): Record<string, unknown>[] {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/v1/current', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(currentExample);
      }),
    );
    return bodies;
  }

  it('shows the current month for the chosen area', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    const now = await screen.findByRole('region', { name: 'Now' });
    expect(await within(now).findByText('November 1 to 13, 2026')).toBeInTheDocument();
    expect(within(now).getByText('Above normal', { selector: 'strong' })).toBeInTheDocument();
  });

  it('asks for the geometry alone and not again when the period changes', async () => {
    const user = userEvent.setup();
    const bodies = recordCurrentRequests();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Draw test area' }));
    const now = await screen.findByRole('region', { name: 'Now' });
    await within(now).findByText('November 1 to 13, 2026');
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0])).toEqual(['geometry']);

    const period = screen.getByRole('group', { name: 'Period' });
    await user.selectOptions(within(period).getByLabelText('From'), '2010');
    await screen.findByRole('grid', { name: /^Fire detections by month, 2010 to/ });
    expect(bodies).toHaveLength(1);
  });

  it('keeps the calendar when the current month cannot be loaded', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/current', () =>
        HttpResponse.json(
          { error: { code: 'NO_DATA', message: 'Outside the coverage.' } },
          { status: 404 },
        ),
      ),
    );
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    const now = await screen.findByRole('region', { name: 'Now' });
    expect(await within(now).findByRole('alert')).toHaveAttribute('data-code', 'NO_DATA');
    expect(
      await screen.findByRole('grid', { name: /^Fire detections by month/ }),
    ).toBeInTheDocument();
  });

  it('is not requested for an area above the size limit', async () => {
    const user = userEvent.setup();
    const bodies = recordCurrentRequests();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Draw huge area' }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Now' })).toBeNull();
    expect(bodies).toHaveLength(0);
  });
});

describe('charts under the calendar (F17, F18)', () => {
  it('draws the season profile and the yearly totals from the loaded calendar', async () => {
    const user = userEvent.setup();
    const bodies = recordCalendarRequests();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    const season = await screen.findByRole('region', { name: 'Season profile' });
    expect(within(season).getByLabelText('Year over the typical season')).toHaveValue(
      String(LAST_YEAR),
    );
    const yearly = screen.getByRole('region', { name: 'Yearly totals' });
    expect(within(yearly).getByTestId('yearly-readout')).toHaveTextContent('Total');

    // Choosing another year re-reads the same response: no new request.
    await user.selectOptions(within(season).getByLabelText('Year over the typical season'), '2010');
    expect(within(season).getByTestId('season-readout')).toHaveTextContent('2010 4,121');
    expect(bodies).toHaveLength(1);
  });

  it('follows the chosen period', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    await screen.findByRole('region', { name: 'Yearly totals' });

    const period = screen.getByRole('group', { name: 'Period' });
    await user.selectOptions(within(period).getByLabelText('From'), '2010');
    await user.selectOptions(within(period).getByLabelText('to'), '2012');
    await screen.findByRole('grid', { name: /^Fire detections by month, 2010 to 2012/ });

    expect(container.querySelectorAll('path[data-year]')).toHaveLength(3);
    const season = screen.getByRole('region', { name: 'Season profile' });
    expect(
      within(within(season).getByLabelText('Year over the typical season')).getAllByRole('option'),
    ).toHaveLength(3);
    // Three complete years are too few for a trend.
    expect(
      screen.getByText('There are too few complete years in this period to fit a trend.'),
    ).toBeInTheDocument();
  });
});

describe('states of a real API (B10)', () => {
  const internalError = () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL', message: 'Something broke on the server.' } },
      { status: 500 },
    );

  it('loads the calendar after "Try again" when the server recovers', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.post('*/api/v1/calendar', () => {
        calls += 1;
        return calls === 1 ? internalError() : HttpResponse.json(calendarExample);
      }),
    );
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'INTERNAL');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    await screen.findByRole('grid', { name: /^Fire detections by month/ });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls).toBe(2);
  });

  it('says that the server cannot be reached and starts once it can', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/api/v1/meta', () => {
        calls += 1;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(metaExample);
      }),
    );
    renderApp();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'NETWORK');
    expect(alert).toHaveTextContent('The server cannot be reached.');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('group', { name: 'Example areas' })).toBeInTheDocument();
  });

  it('does not offer to repeat a request the server refused', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/calendar', () =>
        HttpResponse.json(
          { error: { code: 'NO_DATA', message: 'Outside the coverage.' } },
          { status: 404 },
        ),
      ),
    );
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'NO_DATA');
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('shows a calm message instead of an empty calendar for an area without fires', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/calendar', () =>
        HttpResponse.json({
          ...calendarExample,
          months: calendarExample.months.map((month) => ({ ...month, value: 0, low: 0, high: 0 })),
          yearly: calendarExample.yearly.map((year) => ({ ...year, total: 0 })),
          summary: {
            peak_year: null,
            peak_month: null,
            total: 0,
            trend_pct_per_decade: null,
            trend_line: null,
          },
        }),
      ),
    );
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    const empty = await screen.findByRole('region', { name: 'No fires detected' });
    expect(empty).toHaveTextContent(
      `The satellites recorded no fire detections in this area from ${FIRST_YEAR} to ${LAST_YEAR}.`,
    );
    expect(screen.queryByRole('grid', { name: /^Fire detections by month/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Season profile' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // "Now" is a separate question and still gets its answer.
    expect(await screen.findByRole('region', { name: 'Now' })).toBeInTheDocument();
  });

  it('keeps the calendar on screen, dimmed, while another period loads', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    const grid = await screen.findByRole('grid', { name: /^Fire detections by month, 2000 to/ });
    const results = grid.closest('[aria-busy]');
    expect(results).toHaveAttribute('aria-busy', 'false');

    // From now on the calendar answers slowly, like a real server under load.
    server.use(
      http.post('*/api/v1/calendar', async () => {
        await delay(150);
        return HttpResponse.json({
          ...calendarExample,
          months: calendarExample.months.filter((month) => month.year >= 2010),
          yearly: calendarExample.yearly.filter((year) => year.year >= 2010),
        });
      }),
    );
    const period = screen.getByRole('group', { name: 'Period' });
    await user.selectOptions(within(period).getByLabelText('From'), '2010');

    // The old calendar is still there, marked as busy, with a note next to the area size.
    expect(screen.getByRole('grid', { name: /^Fire detections by month, 2000 to/ })).toBe(grid);
    expect(results).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/updating…/)).toBeInTheDocument();
    expect(screen.queryByText('Loading the calendar…')).toBeNull();

    await screen.findByRole('grid', { name: /^Fire detections by month, 2010 to/ });
    await waitFor(() => expect(screen.queryByText(/updating…/)).toBeNull());
  });

  it('does not show the numbers of one area under the name of another', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    await screen.findByRole('grid', { name: /^Fire detections by month/ });

    server.use(
      http.post('*/api/v1/calendar', async () => {
        await delay(150);
        return HttpResponse.json(calendarExample);
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Southern Amazon' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Southern Amazon' })).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: /^Fire detections by month/ })).toBeNull();
    expect(screen.getByText('Loading the calendar…')).toBeInTheDocument();
    await screen.findByRole('grid', { name: /^Fire detections by month/ });
  });

  it('takes the start of the record and the coverage from the dataset', async () => {
    server.use(
      http.get('*/api/v1/meta', () =>
        HttpResponse.json({
          ...metaExample,
          first_date: '2001-03-01',
          coverage: { global: false, regions: ['Kazakhstan', 'Brazil'] },
        }),
      ),
    );
    renderApp();

    expect(
      await screen.findByText(/Fire activity for every month since March 2001,/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Data is loaded for these regions only: Kazakhstan, Brazil.'),
    ).toBeInTheDocument();
  });
});

describe('link with the state (F26)', () => {
  it('opens the area, the period and the mode an address asks for', async () => {
    window.location.hash = '#/?area=amazon-south&from=2010&to=2012&mode=anomaly';
    const bodies = recordCalendarRequests();
    renderApp();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Southern Amazon' }),
    ).toBeInTheDocument();
    await screen.findByRole('grid', { name: /^Fire anomalies by month/ });
    expect(bodies[0]).toMatchObject({ start_year: 2010, end_year: 2012 });
    expect(screen.getByRole('button', { name: 'Southern Amazon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByLabelText('From')).toHaveValue('2010');
    expect(within(period).getByLabelText('to')).toHaveValue('2012');
  });

  it('opens a drawn area from its outline', async () => {
    window.location.hash = '#/?poly=10,20;12,20;12,22';
    const bodies = recordCalendarRequests();
    renderApp();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Custom area' }),
    ).toBeInTheDocument();
    await screen.findByRole('grid', { name: /^Fire detections by month/ });
    expect(bodies[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [10, 20],
          [12, 20],
          [12, 22],
          [10, 20],
        ],
      ],
    });
  });

  it('keeps the address in step with the screen', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    await screen.findByRole('grid', { name: /^Fire detections by month/ });
    expect(window.location.hash).toBe('#/?area=kz-steppe');

    const period = screen.getByRole('group', { name: 'Period' });
    await user.selectOptions(within(period).getByLabelText('From'), '2010');
    await user.click(screen.getByRole('button', { name: 'Anomaly' }));
    expect(window.location.hash).toBe('#/?area=kz-steppe&from=2010&mode=anomaly');

    await user.click(screen.getByRole('button', { name: 'Clear test area' }));
    expect(window.location.hash).toBe('#/?from=2010&mode=anomaly');
  });

  it('opens the starting screen for a broken link', async () => {
    window.location.hash = '#/?area=atlantis&poly=oops&from=never';
    renderApp();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Choose an area to see its fire calendar',
      }),
    ).toBeInTheDocument();
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByLabelText('From')).toHaveValue(String(FIRST_YEAR));
  });

  it('leads back to the same view from another section', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/?area=amazon-south&from=2015';
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Southern Amazon' });

    await user.click(screen.getByRole('link', { name: 'Method' }));
    await screen.findByRole('heading', { level: 1, name: 'How the record is made' });
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '#/?area=amazon-south&from=2015',
    );

    await user.click(screen.getByRole('link', { name: 'Calendar' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Southern Amazon' }),
    ).toBeInTheDocument();
  });

  it('copies the address of the view', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
    await screen.findByRole('grid', { name: /^Fire detections by month/ });

    await user.click(screen.getByRole('button', { name: 'Copy link to this view' }));

    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(window.location.href);
    expect(window.location.href).toContain('#/?area=kz-steppe');
  });
});

describe('downloads (F22 to F24)', () => {
  it('offers the files once the calendar is loaded', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    const downloads = await screen.findByRole('region', { name: 'Downloads' });
    // The image of the current month joins the list when its own request has answered.
    await within(downloads).findByRole('button', { name: 'Current month (PNG)' });
    expect(
      within(downloads)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Monthly table (CSV)',
      'Hot spots (CSV)',
      'Calendar (PNG)',
      'Season profile (PNG)',
      'Yearly totals (PNG)',
      'Current month (PNG)',
    ]);
    // The dates of the hot spot file follow the period and the record of the dataset.
    const dates = within(downloads).getByRole('group', { name: 'Dates of the hot spot file' });
    expect(within(dates).getByLabelText('From')).toHaveValue(metaExample.first_date);
    expect(within(dates).getByLabelText('to')).toHaveValue(metaExample.last_date);
  });

  it('has nothing to download before an area is chosen', async () => {
    renderApp();

    await screen.findByRole('group', { name: 'Example areas' });
    expect(screen.queryByRole('region', { name: 'Downloads' })).toBeNull();
  });
});

describe('coordinates (F2)', () => {
  it('sets the area from typed bounds and closes the form', async () => {
    const user = userEvent.setup();
    const bodies = recordCalendarRequests();
    renderApp();

    const toggle = await screen.findByRole('button', { name: 'Enter coordinates' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const form = screen.getByRole('form', { name: 'Area by coordinates' });
    await user.type(within(form).getByLabelText('West'), '61');
    await user.type(within(form).getByLabelText('South'), '51');
    await user.type(within(form).getByLabelText('East'), '71');
    await user.type(within(form).getByLabelText('North'), '55');
    await user.click(within(form).getByRole('button', { name: 'Show area' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Custom area' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Area by coordinates' })).toBeNull();
    await screen.findByRole('grid', { name: /^Fire detections by month/ });
    expect(bodies[0].geometry).toEqual({
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
    });
  });
});

describe('method page (F25)', () => {
  it('is reachable from the header', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('link', { name: 'Method' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'How the record is made' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Method' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the checks, the limitations, the method text and the acknowledgment', async () => {
    window.location.hash = '#/method';
    renderApp();

    // The checks come from /method/validation: one block per region with its metrics.
    const checks = await screen.findByRole('region', { name: 'How it was checked' });
    const first = validationExample.regions[0];
    // Regions may share a value, so the number is looked for anywhere among the metrics.
    expect(
      (await within(checks).findAllByText(first.metrics.pearson_r.toFixed(3))).length,
    ).toBeGreaterThan(0);
    expect(
      within(checks)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Northern Kazakhstan',
      'Southern Amazon',
      'Northern California',
      'The seams of the record',
    ]);
    expect(
      within(checks).getByText(
        new RegExp(
          `fitted on ${validationExample.calibration_period.start_year} to ${validationExample.calibration_period.end_year}`,
        ),
      ),
    ).toBeInTheDocument();
    const seams = within(checks).getByRole('table', { name: '' });
    expect(within(seams).getAllByRole('row')).toHaveLength(1 + validationExample.seams.length);

    // "Before and after" needs the raw series of an example area, and one chart per region.
    const effect = screen.getByRole('region', { name: 'What harmonization changes' });
    expect(
      await within(effect).findByRole('slider', { name: 'Year on the chart' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('slider', { name: 'Month on the chart' })).toHaveLength(3);

    const limits = screen.getByRole('region', { name: 'What the record cannot do' });
    expect(within(limits).getAllByRole('listitem')).toHaveLength(
      validationExample.limitations.length,
    );

    // The detailed text is docs/methodology.md itself.
    const details = screen.getByRole('region', { name: 'The method in detail' });
    expect(
      within(details).getByRole('heading', { level: 3, name: '4. Calibration' }),
    ).toBeInTheDocument();
    expect(within(details).queryByText(/Owner: developer A/)).toBeNull();

    const thanks = screen.getByRole('region', { name: 'Data and acknowledgment' });
    expect(thanks).toHaveTextContent(
      "We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS)",
    );
  });

  it('asks for the raw series of the chosen example area', async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/v1/calendar', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(calendarExample);
      }),
    );
    window.location.hash = '#/method';
    renderApp();

    const area = await screen.findByLabelText('Area');
    await screen.findByRole('slider', { name: 'Year on the chart' });
    await user.selectOptions(area, 'Southern Amazon');
    await waitFor(() => expect(bodies).toHaveLength(2));

    expect(bodies[0]).toEqual({ geometry: metaExample.presets[0].geometry, series: 'raw' });
    expect(bodies[1]).toEqual({ geometry: metaExample.presets[1].geometry, series: 'raw' });
  });

  it('keeps the method text readable when the checks cannot be loaded', async () => {
    server.use(
      http.get('*/api/v1/method/validation', () =>
        HttpResponse.json(
          { error: { code: 'NO_DATA', message: 'The report has not been built yet.' } },
          { status: 404 },
        ),
      ),
    );
    window.location.hash = '#/method';
    renderApp();

    const checks = await screen.findByRole('region', { name: 'How it was checked' });
    expect(await within(checks).findByRole('alert')).toHaveAttribute('data-code', 'NO_DATA');
    expect(screen.getByRole('heading', { level: 3, name: '4. Calibration' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'What the record cannot do' })).toBeNull();
  });
});

describe('color scales page', () => {
  it('shows both scales for every kind of color vision', async () => {
    window.location.hash = '#/scales';
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Color scales' })).toBeInTheDocument();
    for (const vision of VISIONS) {
      expect(screen.getAllByRole('heading', { level: 3, name: vision.label })).toHaveLength(2);
    }
    // Calendar samples appear once the data has loaded: one per scale and kind of vision.
    const samples = await screen.findAllByRole('img', { name: /, 2008 to 2013, / });
    expect(samples).toHaveLength(VISIONS.length * 2);
    // The whole interface is in English, the type specimen included.
    expect(document.body.textContent).not.toMatch(/[\u0400-\u04FF]/);
  });
});
