import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import calendarExample from '../../contract/examples/calendar.response.json';
import metaExample from '../../contract/examples/meta.json';
import App from './App';
import { server } from './mocks/server';
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
  });
});
