import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import rawJson from '../../../contract/examples/calendar_raw.response.json';
import validationJson from '../../../contract/examples/method_validation.response.json';
import type { CalendarResponse } from '../api/types';
import { LineChart } from '../components/LineChart';
import { methodologyHtml } from './markdown';
import {
  regionName,
  seamLabel,
  validationPositions,
  validationTicks,
  yearlySensors,
  type ValidationResponse,
} from './series';

const raw = rawJson as unknown as CalendarResponse;
const validation = validationJson as unknown as ValidationResponse;

describe('yearlySensors', () => {
  const years = yearlySensors(raw);
  const of = (year: number) => years.find((item) => item.year === year);

  it('keeps complete years only', () => {
    const incomplete = raw.yearly.filter((year) => !year.complete).map((year) => year.year);
    expect(years.map((item) => item.year)).toEqual(
      raw.yearly.filter((year) => year.complete).map((year) => year.year),
    );
    for (const year of incomplete) expect(of(year)).toBeUndefined();
  });

  it('sums the raw counts of a sensor over the twelve months of a year', () => {
    const months = raw.months.filter((month) => month.year === 2019);
    const modis = months.reduce((sum, month) => sum + (month.raw?.modis ?? 0), 0);
    const viirs = months.reduce((sum, month) => sum + (month.raw?.viirs_snpp ?? 0), 0);

    expect(of(2019)?.modis).toBeCloseTo(modis);
    expect(of(2019)?.viirs).toBeCloseTo(viirs);
    expect(of(2019)?.harmonized).toBe(raw.yearly.find((year) => year.year === 2019)?.total);
  });

  it('has no VIIRS value before VIIRS flew', () => {
    expect(of(2005)?.viirs).toBeNull();
    expect(of(2005)?.modis).toBeGreaterThan(0);
  });
});

describe('labels of the validation', () => {
  it('names the months and marks every January with its year', () => {
    const region = validation.regions[0];

    expect(validationPositions(region)[0]).toBe('January 2021');
    expect(validationPositions(region)).toHaveLength(region.series.length);
    expect(validationTicks(region)).toEqual([
      { index: 0, label: '2021' },
      { index: 12, label: '2022' },
      { index: 24, label: '2023' },
      { index: 36, label: '2024' },
      { index: 48, label: '2025' },
    ]);
  });

  it('names regions and seams in the words of the app, by their ids', () => {
    expect(validation.regions.map(regionName)).toEqual([
      'Northern Kazakhstan',
      'Southern Amazon',
      'Northern California',
    ]);
    expect(seamLabel(validation.seams[0])).toBe(
      'MODIS to Suomi NPP, 2012: the three years after against the three before',
    );
  });

  it('falls back to the server text for a region it does not know', () => {
    expect(regionName({ ...validation.regions[0], id: 'siberia', name: 'Server name' })).toBe(
      'Server name',
    );
  });
});

describe('methodologyHtml', () => {
  const html = methodologyHtml(
    [
      '# Title',
      '',
      '> Owner: developer A. A note for the team.',
      '',
      '## 1. Task',
      '',
      'Merge **two** records. See [FIRMS](https://example.org/firms).',
      '',
      '| Sensor | Years |',
      '| --- | --- |',
      '| MODIS | 2000 |',
      '',
      '### Detail',
    ].join('\n'),
  );

  it('leaves out the title and the note above the first section', () => {
    expect(html).not.toContain('Owner: developer A');
    expect(html).not.toContain('Title');
  });

  it('moves headings one level down, under the headings of the page', () => {
    expect(html).toContain('<h3>1. Task</h3>');
    expect(html).toContain('<h4>Detail</h4>');
    expect(html).not.toContain('<h2>');
  });

  it('lets wide tables scroll and opens outside links in a new tab', () => {
    expect(html).toContain('<div class="table-scroll"><table>');
    expect(html).toContain('</table></div>');
    expect(html).toContain('<a target="_blank" rel="noreferrer" href="https://example.org/firms">');
    expect(html).toContain('<strong>two</strong>');
  });
});

describe('LineChart', () => {
  function renderChart() {
    return render(
      <LineChart
        caption="Fire detections per year"
        positions={['2010', '2011', '2012']}
        ticks={[{ index: 0, label: '2010' }]}
        positionName="Year"
        series={[
          { id: 'a', label: 'Harmonized', color: '--series-main', values: [10, 20, 30] },
          {
            id: 'b',
            label: 'VIIRS',
            color: '--series-purple',
            dashed: true,
            values: [null, null, 31],
          },
        ]}
      />,
    );
  }

  it('reads out the last position by default and says where a sensor has no data', async () => {
    const user = userEvent.setup();
    renderChart();

    const slider = screen.getByRole('slider', { name: 'Year on the chart' });
    expect(slider).toHaveAttribute('aria-valuetext', '2012: Harmonized 30, VIIRS 31');

    slider.focus();
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuetext', '2010: Harmonized 10, VIIRS no data');
  });

  it('breaks a line at its gaps instead of drawing through them', () => {
    const { container } = renderChart();

    // One run for the full series, one for the single point of the other.
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('gives the same numbers as a table', () => {
    renderChart();

    const table = screen.getByRole('table', { name: 'Fire detections per year' });
    expect(within(table).getByRole('row', { name: '2011 20 no data' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: '2012 30 31' })).toBeInTheDocument();
  });
});
