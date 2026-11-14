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

// The real map needs WebGL. This stand-in exposes the two things the screen relies on:
// the map reports a drawn area, and the map reports that the area was cleared.
vi.mock('./components/AreaMap', () => ({
  AreaMap: ({ onChange }: { onChange: (geometry: unknown) => void }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onChange({
            type: 'Polygon',
            coordinates: [
              [
                [10, 20],
                [12, 20],
                [12, 22],
                [10, 20],
              ],
            ],
          })
        }
      >
        Draw test area
      </button>
      <button type="button" onClick={() => onChange(null)}>
        Clear test area
      </button>
    </div>
  ),
}));

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
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
    expect(screen.queryByRole('img', { name: /^Fire detections by month/ })).toBeNull();
  });

  it('loads the calendar for an example area', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'Northern Kazakhstan' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Northern Kazakhstan' }),
    ).toBeInTheDocument();
    await screen.findByRole('img', { name: /^Fire detections by month/ });
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
    await screen.findByRole('img', { name: /^Fire detections by month/ });
    const seam = (month: string) =>
      container.querySelector(`[data-month="${month}"]`)?.getAttribute('data-seam') ?? '';

    // January 2012 is still led by MODIS; Suomi NPP takes over in February.
    expect(seam('2012-01')).not.toContain('left');
    expect(seam('2012-02')).toContain('left');
    expect(seam('2012-03')).not.toContain('left');
    // February 2012 and February 2011 were led by different sensors.
    expect(seam('2012-02')).toContain('bottom');
  });

  it('sends a drawn area to the API as GeoJSON', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/v1/calendar', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(calendarExample);
      }),
    );
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Draw test area' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Custom area' }),
    ).toBeInTheDocument();
    await screen.findByRole('img', { name: /^Fire detections by month/ });
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

  it('shows the API error code and message', async () => {
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
    expect(alert).toHaveTextContent('INTERNAL');
    expect(alert).toHaveTextContent('Service is temporarily unavailable.');
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
