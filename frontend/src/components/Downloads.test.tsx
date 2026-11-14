import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import metaJson from '../../../contract/examples/meta.json';
import type { CalendarResponse, Meta } from '../api/types';
import * as files from '../export/files';
import * as png from '../export/png';
import { server } from '../mocks/server';
import { Downloads } from './Downloads';
import { SeasonProfile } from './SeasonProfile';
import { YearlyTotals } from './YearlyTotals';

const calendar = calendarJson as unknown as CalendarResponse;
const meta = metaJson as unknown as Meta;
const preset = meta.presets[0];

const scope: files.ExportScope = {
  geometry: preset.geometry,
  presetId: preset.id,
  startYear: 2010,
  endYear: 2012,
};

/** The panel as far as downloads need it: the two charts and the buttons. */
function renderDownloads(overrides: Partial<Parameters<typeof Downloads>[0]> = {}) {
  return render(
    <>
      <SeasonProfile calendar={calendar} />
      <YearlyTotals calendar={calendar} />
      <Downloads
        scope={scope}
        areaName="Northern Kazakhstan"
        calendar={calendar}
        meta={meta}
        mode="count"
        {...overrides}
      />
    </>,
  );
}

const button = (name: string) =>
  within(screen.getByRole('group', { name: 'Files to download' })).getByRole('button', { name });

describe('Downloads', () => {
  // The browser's download and the canvas are replaced: jsdom has neither.
  let saved: { blob: Blob; name: string }[];
  let rendered: png.PngSpec[];

  beforeEach(() => {
    saved = [];
    rendered = [];
    vi.spyOn(files, 'saveBlob').mockImplementation((blob, name) => {
      saved.push({ blob, name });
    });
    vi.spyOn(png, 'renderPng').mockImplementation((spec) => {
      rendered.push(spec);
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves the monthly table as CSV for the area and the years (F23)', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/v1/export/calendar.csv', async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse('year,month,value\n2010,1,26.8\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      }),
    );
    renderDownloads();

    await user.click(button('Monthly table (CSV)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(bodies).toEqual([{ geometry: preset.geometry, start_year: 2010, end_year: 2012 }]);
    expect(saved[0].name).toBe('firms-calendar_kz-steppe_2010-2012.csv');
    expect(await saved[0].blob.text()).toBe('year,month,value\n2010,1,26.8\n');
  });

  it('asks for the hot spots of whole years as dates (F22)', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/v1/export/points.csv', async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse('lat,lon\n53,67\n', { headers: { 'Content-Type': 'text/csv' } });
      }),
    );
    renderDownloads();

    await user.click(button('Hot spots (CSV)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(bodies).toEqual([
      { geometry: preset.geometry, start_date: '2010-01-01', end_date: '2012-12-31' },
    ]);
    expect(saved[0].name).toBe('firms-hotspots_kz-steppe_2010-2012.csv');
  });

  it('says so when the export has more rows than the limit (F22)', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/export/points.csv', () =>
        HttpResponse.json(
          { error: { code: 'EXPORT_TOO_LARGE', message: 'Too many rows.' } },
          { status: 413 },
        ),
      ),
    );
    renderDownloads();

    await user.click(button('Hot spots (CSV)'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'EXPORT_TOO_LARGE');
    expect(alert).toHaveTextContent(
      'The export has too many rows. Shorten the period or reduce the area.',
    );
    expect(saved).toHaveLength(0);
    // The buttons work again after the failure.
    expect(button('Hot spots (CSV)')).toBeEnabled();
  });

  it('warns beforehand when the period likely exceeds the row limit', () => {
    const small = { ...meta, limits: { ...meta.limits, max_export_rows: 1000 } };
    renderDownloads({ meta: small });

    expect(
      screen.getByText('This period likely has more: choose fewer years or a smaller area.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/up to 1,000 rows/)).toBeInTheDocument();
  });

  it('does not warn when the period fits', () => {
    renderDownloads();

    expect(screen.queryByText(/This period likely has more/)).toBeNull();
  });

  it('saves the calendar as an image with a caption (F24)', async () => {
    const user = userEvent.setup();
    renderDownloads();

    await user.click(button('Calendar (PNG)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('firms-calendar_kz-steppe_2010-2012.png');
    expect(rendered[0].title).toBe('Burn calendar: fire detections by month');
    expect(rendered[0].figure.markup).toContain('<svg');
    expect(rendered[0].caption[0]).toMatch(/^Northern Kazakhstan: 61°E to 71°E, 51°N to 55°N, /);
    expect(rendered[0].caption[1]).toMatch(/^Period: 2010 to 2012\. /);
    expect(rendered[0].caption[2]).toContain('NASA FIRMS');
  });

  it('saves the calendar in the mode that is on screen', async () => {
    const user = userEvent.setup();
    renderDownloads({ mode: 'anomaly' });

    await user.click(button('Calendar (PNG)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('firms-calendar-anomaly_kz-steppe_2010-2012.png');
    expect(rendered[0].title).toBe('Burn calendar: difference from the median by month');
  });

  it('saves the season profile with the chosen year in its title and legend (F24)', async () => {
    const user = userEvent.setup();
    renderDownloads();
    await user.selectOptions(screen.getByLabelText('Year over the typical season'), '2010');

    await user.click(button('Season profile (PNG)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('firms-season-profile_kz-steppe_2010-2012.png');
    expect(rendered[0].title).toBe('Season profile: 2010 over the typical season');
    expect(rendered[0].legend?.map((item) => item.label)).toEqual([
      '2010',
      'Median of the baseline years',
      '10th to 90th percentile',
    ]);
    // The picture has no marks of the interaction.
    expect(rendered[0].figure.markup).not.toContain('data-export-skip');
  });

  it('saves the yearly totals with the trend in the legend (F24)', async () => {
    const user = userEvent.setup();
    renderDownloads();

    await user.click(button('Yearly totals (PNG)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('firms-yearly-totals_kz-steppe_2010-2012.png');
    expect(rendered[0].legend?.map((item) => item.label)).toEqual([
      'Yearly total',
      'Incomplete year',
      'Trend',
    ]);
  });

  it('leaves the trend out of the legend when there is no trend line', async () => {
    const user = userEvent.setup();
    const noTrend: CalendarResponse = {
      ...calendar,
      summary: { ...calendar.summary, trend_pct_per_decade: null, trend_line: null },
    };
    renderDownloads({ calendar: noTrend });

    await user.click(button('Yearly totals (PNG)'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(rendered[0].legend?.map((item) => item.label)).toEqual([
      'Yearly total',
      'Incomplete year',
    ]);
  });

  it('names the data source next to the buttons', () => {
    renderDownloads();

    expect(screen.getByText(/^Data: NASA FIRMS active fire detections/)).toBeInTheDocument();
  });
});
