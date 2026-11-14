import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import calendarExample from '../../../contract/examples/calendar.response.json';
import calendarRawExample from '../../../contract/examples/calendar_raw.response.json';
import pointsExample from '../../../contract/examples/points.response.json';
import type { PointsResponse } from '../api/types';
import { server } from '../mocks/server';
import { writeSearch } from '../state/link';
import { CalendarScreen } from './CalendarScreen';

// The real map needs WebGL. This stand-in shows what the screen hands to the map:
// how many hot spots it is asked to draw.
vi.mock('../components/AreaMap', () => ({
  AreaMap: ({ points }: { points?: PointsResponse | null }) => (
    <div data-testid="map" data-points={points ? points.features.length : 'none'} />
  ),
}));

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarScreen />
    </QueryClientProvider>,
  );
}

/** Records request bodies of one endpoint while answering with the given example. */
function record(path: string, answer: unknown): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(`*/api/v1${path}`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(answer as Record<string, unknown>);
    }),
  );
  return bodies;
}

async function openArea(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));
  await screen.findByRole('grid', { name: /^Fire detections by month, / });
}

afterEach(() => {
  window.location.hash = '';
  writeSearch('');
});

describe('original sensors (F19)', () => {
  it('asks for the raw counts only when the view is opened, and shows them', async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/v1/calendar', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json(body.series === 'raw' ? calendarRawExample : calendarExample);
      }),
    );
    const { container } = renderScreen();
    await openArea(user);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('series');

    const modes = screen.getByRole('group', { name: 'Calendar mode' });
    await user.click(within(modes).getByRole('button', { name: 'Original sensors' }));

    await screen.findByRole('grid', {
      name: /^Fire detections by month as the sensors recorded them/,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ series: 'raw' });

    // January 2012 is the last month led by MODIS: its cell shows what MODIS recorded.
    expect(container.querySelector('[data-month="2012-01"]')).toHaveAttribute(
      'aria-label',
      'January 2012: 1.3 detections recorded by MODIS Terra + Aqua, 4.3 in the harmonized record',
    );
    // The yearly total is the sum of the raw counts, not the harmonized 2,435.6.
    expect(screen.getByRole('gridcell', { name: '2011 total: 552' })).toBeInTheDocument();
    expect(screen.getByText(/the step at the dark lines is the difference/)).toBeInTheDocument();
  });

  it('writes the view into the link', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);

    await user.click(screen.getByRole('button', { name: 'Original sensors' }));

    await waitFor(() => expect(window.location.hash).toBe('#/?area=kz-steppe&mode=raw'));
  });
});

describe('hot spots of a month on the map (F13)', () => {
  it('shows the latest complete month with fire as soon as the area opens', async () => {
    const user = userEvent.setup();
    const bodies = record('/points', pointsExample);
    const { container } = renderScreen();
    await openArea(user);

    // The example calendar ends with a partial November 2026; October is the latest complete month.
    expect(
      await screen.findByText(
        `October 2026: ${pointsExample.total} hot spots on the map, all sensors.`,
      ),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ year: 2026, month: 10 });
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-points',
      String(pointsExample.features.length),
    );
    expect(container.querySelector('[data-month="2026-10"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('asks for the clicked month, hands the points to the map and says how many there are', async () => {
    const user = userEvent.setup();
    const bodies = record('/points', pointsExample);
    const { container } = renderScreen();
    await openArea(user);

    const cell = container.querySelector<HTMLElement>('[data-month="2020-08"]');
    await user.click(cell as HTMLElement);

    expect(
      await screen.findByText(
        `August 2020: ${pointsExample.total} hot spots on the map, all sensors.`,
      ),
    ).toBeInTheDocument();
    expect(bodies.at(-1)).toMatchObject({ year: 2020, month: 8 });
    expect(bodies.at(-1)).toHaveProperty('geometry.type', 'Polygon');
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-points',
      String(pointsExample.features.length),
    );
    expect(cell).toHaveAttribute('aria-selected', 'true');
  });

  it('says so when only a part of the points fits on the map', async () => {
    const user = userEvent.setup();
    record('/points', { ...pointsExample, total: 165893, truncated: true });
    const { container } = renderScreen();
    await openArea(user);

    await user.click(container.querySelector('[data-month="2020-09"]') as HTMLElement);

    expect(
      await screen.findByText(/^September 2020: the 12 strongest of 165,893 hot spots on the map/),
    ).toBeInTheDocument();
  });

  it('removes the points with the button, with a second click and with a change of area', async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    await openArea(user);
    const cell = () => container.querySelector('[data-month="2020-08"]') as HTMLElement;
    const drawn = () => screen.getByTestId('map').getAttribute('data-points');

    // Hiding the default month keeps the map clear for this area.
    await waitFor(() => expect(drawn()).not.toBe('none'));
    await user.click(screen.getByRole('button', { name: 'Hide hot spots' }));
    expect(drawn()).toBe('none');
    expect(screen.queryByRole('button', { name: 'Hide hot spots' })).toBeNull();

    await user.click(cell());
    await waitFor(() => expect(drawn()).not.toBe('none'));
    await user.click(screen.getByRole('button', { name: 'Hide hot spots' }));
    expect(drawn()).toBe('none');
    expect(cell()).toHaveAttribute('aria-selected', 'false');

    await user.click(cell());
    await waitFor(() => expect(drawn()).not.toBe('none'));
    await user.click(cell());
    expect(drawn()).toBe('none');

    await user.click(cell());
    await waitFor(() => expect(drawn()).not.toBe('none'));
    // Another area drops the picked month and opens with its own latest month.
    await user.click(screen.getByRole('button', { name: 'Southern Amazon' }));
    expect(await screen.findByText(/^October 2026: /)).toBeInTheDocument();
    expect(cell()).toHaveAttribute('aria-selected', 'false');
  });

  it('picks a month from the keyboard', async () => {
    const user = userEvent.setup();
    const bodies = record('/points', pointsExample);
    const { container } = renderScreen();
    await openArea(user);

    (container.querySelector('[data-month="2019-07"]') as HTMLElement).focus();
    await user.keyboard('{Enter}');

    await screen.findByText(/^July 2019: /);
    expect(bodies.at(-1)).toMatchObject({ year: 2019, month: 7 });
  });

  it('says how to pick another month next to the count', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);

    await screen.findByText(/^October 2026: /);
    expect(
      screen.getByText(
        /^Drag the ends to show up to 6 months, step with the arrows, or click a month/,
      ),
    ).toBeInTheDocument();
  });

  it('stays quiet when the month nobody asked for cannot be loaded', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/points', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'Points are not available.' } },
          { status: 500 },
        ),
      ),
    );
    renderScreen();
    await openArea(user);

    // The calendar is there, and no error about points the user never asked for.
    await screen.findByRole('region', { name: 'Now' });
    const map = screen.getByRole('region', { name: 'Area selection' });
    await waitFor(() => expect(within(map).queryByText(/^Loading the hot spots/)).toBeNull());
    expect(within(map).queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide hot spots' })).toBeNull();
    expect(screen.getByTestId('map')).toHaveAttribute('data-points', 'none');
  });

  it('does not ask for points of an area above the size limit', async () => {
    const bodies = record('/points', pointsExample);
    window.location.hash = '#/?poly=-60,-40;60,-40;60,40;-60,40';
    renderScreen();

    await screen.findByText(/The limit is 3,000,000 km²/);
    expect(bodies).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Hide hot spots' })).toBeNull();
  });

  it('keeps the calendar when the points cannot be loaded', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/points', () =>
        HttpResponse.json(
          { error: { code: 'NO_DATA', message: 'No points for this month.' } },
          { status: 404 },
        ),
      ),
    );
    const { container } = renderScreen();
    await openArea(user);

    await user.click(container.querySelector('[data-month="2020-08"]') as HTMLElement);

    const map = screen.getByRole('region', { name: 'Area selection' });
    expect(await within(map).findByRole('alert')).toHaveAttribute('data-code', 'NO_DATA');
    expect(screen.getByRole('grid', { name: /^Fire detections by month/ })).toBeInTheDocument();
  });
});

// The months of a moved slider are asked for once it rests (400 ms), then the mock answers.
const SETTLED = { timeout: 3000 };

describe('months and fire power of the hot spots', () => {
  it('shows a span of months when an end of the slider is moved', async () => {
    const user = userEvent.setup();
    const bodies = record('/points', pointsExample);
    const { container } = renderScreen();
    await openArea(user);
    await screen.findByText(/^October 2026: /);

    // October 2026 is month 2026 × 12 + 9; the first end goes one month back.
    const months = screen.getByRole('group', { name: 'Months on the map' });
    const first = within(months).getByRole('slider', { name: 'First month on the map' });
    expect(first).toHaveValue(String(2026 * 12 + 9));
    fireEvent.change(first, { target: { value: String(2026 * 12 + 8) } });

    expect(
      await screen.findByText(
        `September to October 2026: ${pointsExample.total * 2} hot spots on the map, all sensors.`,
        {},
        SETTLED,
      ),
    ).toBeInTheDocument();
    // One request per month; October was already there and is not asked again.
    expect(bodies.map((body) => body.month)).toEqual([10, 9]);
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-points',
      String(pointsExample.features.length * 2),
    );
    for (const id of ['2026-09', '2026-10']) {
      expect(container.querySelector(`[data-month="${id}"]`)).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
  });

  it('asks only for the months where a dragged slider rests', async () => {
    const user = userEvent.setup();
    const bodies = record('/points', pointsExample);
    renderScreen();
    await openArea(user);
    await screen.findByText(/^October 2026: /);
    await waitFor(() => expect(bodies).toHaveLength(1));

    // A drag passes many positions within a second; each used to send its own requests,
    // and a burst of them exhausted the memory of the server.
    const months = screen.getByRole('group', { name: 'Months on the map' });
    const first = within(months).getByRole('slider', { name: 'First month on the map' });
    for (let month = 9; month >= 5; month -= 1) {
      fireEvent.change(first, { target: { value: String(2026 * 12 + month - 1) } });
    }
    // The span shows at once; nothing is asked for before the slider rests.
    expect(screen.getByText('Loading the hot spots of May to October 2026…')).toBeInTheDocument();
    expect(bodies).toHaveLength(1);

    expect(
      await screen.findByText(
        `May to October 2026: ${pointsExample.total * 6} hot spots on the map, all sensors.`,
        {},
        SETTLED,
      ),
    ).toBeInTheDocument();
    // October was on the map already; each month of the resting span is asked for once.
    expect(bodies[0]).toMatchObject({ month: 10 });
    expect(
      bodies
        .slice(1)
        .map((body) => Number(body.month))
        .sort((a, b) => a - b),
    ).toEqual([5, 6, 7, 8, 9]);
  });

  it('never shows more than six months: the other end follows', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);
    await screen.findByText(/^October 2026: /);

    const months = screen.getByRole('group', { name: 'Months on the map' });
    const first = within(months).getByRole('slider', { name: 'First month on the map' });
    const last = within(months).getByRole('slider', { name: 'Last month on the map' });
    fireEvent.change(first, { target: { value: String(2020 * 12) } });

    expect(first).toHaveValue(String(2020 * 12));
    expect(last).toHaveValue(String(2020 * 12 + 5));
    await screen.findByText(/^January to June 2020: /, {}, SETTLED);
  });

  it('steps the whole span one month earlier or later', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);
    await screen.findByText(/^October 2026: /);

    await user.click(screen.getByRole('button', { name: 'One month earlier' }));
    await screen.findByText(/^September 2026: /, {}, SETTLED);
    await user.click(screen.getByRole('button', { name: 'One month later' }));
    await user.click(screen.getByRole('button', { name: 'One month later' }));
    await screen.findByText(/^November 2026: /, {}, SETTLED);
    // November 2026 is the last month of the record: there is nothing later.
    expect(screen.getByRole('button', { name: 'One month later' })).toBeDisabled();
  });

  it('returns to one month when a month of the calendar is clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    await openArea(user);
    await screen.findByText(/^October 2026: /);
    const months = screen.getByRole('group', { name: 'Months on the map' });
    fireEvent.change(within(months).getByRole('slider', { name: 'First month on the map' }), {
      target: { value: String(2026 * 12 + 7) },
    });
    await screen.findByText(/^August to October 2026: /, {}, SETTLED);

    await user.click(container.querySelector('[data-month="2021-07"]') as HTMLElement);

    await screen.findByText(/^July 2021: /, {}, SETTLED);
    expect(within(months).getByRole('slider', { name: 'Last month on the map' })).toHaveValue(
      String(2021 * 12 + 6),
    );
  });

  it('keeps only the stronger fires when a class of the legend is clicked', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openArea(user);
    await screen.findByText(/^October 2026: /);

    const power = screen.getByRole('group', { name: 'Fire power of the dots' });
    const bands = within(power).getAllByRole('button');
    expect(bands.length).toBeGreaterThan(1);
    expect(bands[0]).toHaveAttribute('aria-pressed', 'true');

    await user.click(bands[bands.length - 1]);

    expect(bands[bands.length - 1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/^October 2026: .* Shown: \d+ of [\d.,]+ MW or more\.$/)).toBeVisible();
    // The weakest class brings all the dots back.
    await user.click(bands[0]);
    expect(screen.queryByText(/Shown: /)).toBeNull();
  });
});

describe('daily calendar (F14)', () => {
  it('asks for the newest year first and for another year when it is chosen', async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/v1/daily', async ({ request }) => {
        const body = (await request.json()) as { year: number };
        bodies.push(body);
        return HttpResponse.json({
          year: body.year,
          unit: 'viirs_snpp_equivalent_detections',
          metric: 'count',
          days: [
            { date: `${body.year}-01-01`, value: 3, preliminary: false },
            { date: `${body.year}-01-02`, value: 7, preliminary: false },
          ],
        });
      }),
    );
    renderScreen();
    await openArea(user);

    const daily = screen.getByRole('region', { name: 'Daily calendar' });
    const newest = calendarExample.yearly[calendarExample.yearly.length - 1].year;
    await within(daily).findByRole('grid', {
      name: new RegExp(`^Fire detections by day, ${newest}`),
    });
    expect(bodies).toEqual([expect.objectContaining({ year: newest })]);

    await user.selectOptions(within(daily).getByLabelText('Year'), '2010');
    await within(daily).findByRole('grid', { name: /^Fire detections by day, 2010/ });
    expect(bodies[1]).toMatchObject({ year: 2010 });
    expect(within(daily).getByTestId('daily-readout')).toHaveTextContent(
      'Busiest day: January 2, 2010: 7 detections',
    );
  });
});

describe('a link opened in a tab that already shows the app (F26)', () => {
  async function openLink(hash: string) {
    window.location.hash = hash;
    renderScreen();
    await screen.findByRole('grid', { name: /^Fire detections by month, / });
  }

  it('opens the area, period and mode of a link pasted into the address bar', async () => {
    await openLink('#/?area=kz-steppe');

    window.location.hash = '#/?area=amazon-south&from=2010&to=2020&mode=anomaly';

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Southern Amazon' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: 'Northern Kazakhstan' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByLabelText('From')).toHaveValue('2010');
    expect(screen.getByLabelText('to')).toHaveValue('2020');
    expect(await screen.findByRole('button', { name: 'Anomaly' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.location.hash).toBe('#/?area=amazon-south&from=2010&to=2020&mode=anomaly');
  });

  it('returns to the starting state for the plain address', async () => {
    await openLink('#/?area=kz-steppe');

    window.location.hash = '#/';

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Northern Kazakhstan' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
  });

  it('keeps its state when the address moves to another section', async () => {
    await openLink('#/?area=kz-steppe');

    window.location.hash = '#/method';
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(screen.getByRole('button', { name: 'Northern Kazakhstan' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
