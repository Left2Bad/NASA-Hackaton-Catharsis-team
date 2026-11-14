import { describe, expect, it } from 'vitest';
import calendarJson from '../../../contract/examples/calendar.response.json';
import metaJson from '../../../contract/examples/meta.json';
import type { CalendarResponse, Geometry, Meta } from '../api/types';
import { calendarSvg } from './calendarSvg';
import { captionLines, SOURCE_LINE } from './caption';
import { chartSvg } from './chartSvg';
import { EXPORT_FONT, PAGE_FONT, withStyle } from './font';
import {
  areaSlug,
  exportDates,
  exportFileName,
  nowFileName,
  yearsSlug,
  type ExportScope,
} from './files';
import { layoutPng, type PngSpec } from './png';

const calendar = calendarJson as unknown as CalendarResponse;
const meta = metaJson as unknown as Meta;

const box = (west: number, south: number, east: number, north: number): Geometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

const scope: ExportScope = {
  geometry: box(61, 51, 71, 55),
  presetId: 'kz-steppe',
  startYear: 2000,
  endYear: 2026,
};

describe('file names', () => {
  it('names an example area by its id', () => {
    expect(areaSlug(scope)).toBe('kz-steppe');
    expect(exportFileName('calendar', scope, 'csv')).toBe('firms-calendar_kz-steppe_2000-2026.csv');
  });

  it('names a custom area by its bounds, without signs that file systems dislike', () => {
    const custom = { geometry: box(-62.5, -13, -52, 7.25), presetId: null };
    expect(areaSlug(custom)).toBe('62.5W-52W_13S-7.25N');
  });

  it('writes a single year once', () => {
    expect(yearsSlug({ startYear: 2015, endYear: 2015 })).toBe('2015');
    expect(exportFileName('hotspots', { ...scope, startYear: 2015, endYear: 2015 }, 'csv')).toBe(
      'firms-hotspots_kz-steppe_2015.csv',
    );
  });
});

describe('the page font in exported images', () => {
  it('asks for the typeface of the page first, with system fonts behind it', () => {
    expect(EXPORT_FONT.startsWith(`'${PAGE_FONT}'`)).toBe(true);
    expect(EXPORT_FONT).toContain('system-ui');
    expect(calendarSvg(calendar, meta.sources, 'count').markup).toContain(
      `font-family="${EXPORT_FONT}"`,
    );
  });

  it('puts the font rule inside the drawing, right after its opening tag', () => {
    const css =
      "@font-face{font-family:'Geologica Variable';src:url(data:font/woff2;base64,AAAA);}";
    expect(withStyle('<svg width="10" height="10"><rect/></svg>', css)).toBe(
      `<svg width="10" height="10"><style>${css}</style><rect/></svg>`,
    );
  });

  it('leaves the drawing alone when the font could not be loaded', () => {
    expect(withStyle('<svg><rect/></svg>', '')).toBe('<svg><rect/></svg>');
  });
});

describe('nowFileName', () => {
  it('puts the month where other files have the years', () => {
    expect(nowFileName(scope, 2026, 3)).toBe('firms-current-month_kz-steppe_2026-03.png');
  });
});

describe('exportDates (F22)', () => {
  it('turns whole years into dates', () => {
    expect(exportDates({ startYear: 2010, endYear: 2012 }, meta)).toEqual({
      start_date: '2010-01-01',
      end_date: '2012-12-31',
    });
  });

  it('never leaves the record of the dataset', () => {
    // The example record runs from 2000-11-01 to 2026-11-13.
    expect(exportDates({ startYear: 2000, endYear: 2026 }, meta)).toEqual({
      start_date: meta.first_date,
      end_date: meta.last_date,
    });
  });
});

describe('captionLines (F24)', () => {
  it('names the area, the period and the data source', () => {
    expect(captionLines(scope, 'Northern Kazakhstan', calendar, meta)).toEqual([
      `Northern Kazakhstan: 61°E to 71°E, 51°N to 55°N, ${Math.round(calendar.area_km2).toLocaleString('en-US')} km²`,
      `Period: 2000 to 2026. Data through ${calendar.data_through}, version ${meta.data_version}.`,
      SOURCE_LINE,
    ]);
    expect(SOURCE_LINE).toContain('NASA FIRMS');
  });

  it('writes a single year without a range', () => {
    const lines = captionLines(
      { ...scope, startYear: 2015, endYear: 2015 },
      'Area',
      calendar,
      meta,
    );
    expect(lines[1]).toMatch(/^Period: 2015\. /);
  });
});

describe('calendarSvg (F24)', () => {
  const parse = (markup: string) =>
    new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;

  it('is a well-formed standalone SVG of the stated size', () => {
    const figure = calendarSvg(calendar, meta.sources, 'count');
    const svg = parse(figure.markup);

    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(Number(svg.getAttribute('width'))).toBe(figure.width);
    expect(Number(svg.getAttribute('height'))).toBe(figure.height);
  });

  it('draws every year, every yearly total and the legend', () => {
    const texts = Array.from(
      parse(calendarSvg(calendar, meta.sources, 'count').markup).querySelectorAll('text'),
    ).map((node) => node.textContent);

    for (const year of calendar.yearly) {
      expect(texts).toContain(String(year.year));
    }
    expect(texts).toContain('12,877');
    expect(texts).toContain('Total');
    expect(texts).toContain('Median');
    expect(texts).toContain('Fire detections per month, VIIRS-equivalent');
  });

  it('marks the change of sensor and the preliminary months', () => {
    const svg = parse(calendarSvg(calendar, meta.sources, 'count').markup);

    // One path carries all seam segments; a triangle marks each preliminary month.
    expect(svg.querySelector('path[stroke-width="2"]')?.getAttribute('d')).toMatch(/M.+V.+/);
    const preliminary = calendar.months.filter((month) => month.preliminary).length;
    expect(svg.querySelectorAll('path[d$="Z"]')).toHaveLength(preliminary);
  });

  it('switches the scale and the legend in the anomaly mode', () => {
    const markup = calendarSvg(calendar, meta.sources, 'anomaly').markup;

    expect(markup).toContain('Difference from the median of the same calendar month');
    expect(markup).toContain('+150 %');
    // A month that cannot be compared is hatched instead of colored.
    expect(markup).toContain('fill="url(#uncompared)"');
    expect(markup).not.toContain('>Median<');
  });

  it('fits the notes of the legend inside the drawing', () => {
    const figure = calendarSvg(calendar, meta.sources, 'count');
    const longest = Math.max(
      ...Array.from(parse(figure.markup).querySelectorAll('text')).map(
        (node) => (node.textContent ?? '').length,
      ),
    );
    // About 6 px per character at this size: the longest line must stay inside the width.
    expect(50 + longest * 6).toBeLessThanOrEqual(figure.width);
  });
});

describe('chartSvg (F24)', () => {
  it('copies the chart without the marks of the interaction and without classes', () => {
    document.body.innerHTML = `
      <svg width="480" height="200" class="plot" aria-hidden="true">
        <path class="line" d="M0 0L10 10" />
        <circle class="dot" data-export-skip="" cx="5" cy="5" r="4" />
        <rect class="hit" data-export-skip="" width="480" height="200" />
        <text class="tick" x="0" y="10">100</text>
      </svg>`;
    const svg = document.querySelector('svg') as SVGSVGElement;

    const figure = chartSvg(svg);
    const copy = new DOMParser().parseFromString(figure.markup, 'image/svg+xml').documentElement;

    expect(figure).toMatchObject({ width: 480, height: 200 });
    expect(copy.querySelector('circle')).toBeNull();
    expect(copy.querySelector('rect')).toBeNull();
    expect(copy.querySelector('path')).not.toBeNull();
    expect(copy.querySelector('text')?.textContent).toBe('100');
    expect(copy.querySelectorAll('[class]')).toHaveLength(0);
    expect(copy.hasAttribute('aria-hidden')).toBe(false);
    expect(copy.getAttribute('font-family')).toBe(EXPORT_FONT);
    // The chart on the page is left as it was.
    expect(svg.querySelector('circle')).not.toBeNull();
    document.body.innerHTML = '';
  });
});

describe('layoutPng (F24)', () => {
  const measure = (text: string) => text.length * 8;
  const spec: PngSpec = {
    title: 'Fire detections per year',
    legend: [
      { kind: 'box', color: '#c85d02', label: 'Yearly total' },
      { kind: 'line', color: '#16212b', label: 'Trend' },
    ],
    figure: { markup: '<svg/>', width: 480, height: 200 },
    caption: [
      'Area',
      'Period',
      'A long line about the source of the data, longer than the chart itself is wide.',
    ],
  };

  it('stacks the title, the legend, the drawing and the caption', () => {
    const layout = layoutPng(spec, measure);

    expect(layout.titleY).toBeLessThan(layout.legendY);
    expect(layout.legendY).toBeLessThan(layout.figureY);
    expect(layout.captionY[0]).toBeGreaterThan(layout.figureY + spec.figure.height);
    expect(layout.captionY).toHaveLength(3);
    expect(layout.height).toBeGreaterThan(layout.captionY[2]);
    expect(layout.legendX[1]).toBeGreaterThan(layout.legendX[0]);
  });

  it('is as wide as its widest part, with a margin on both sides', () => {
    const layout = layoutPng(spec, measure);
    expect(layout.width).toBe(measure(spec.caption[2]) + 48);

    const short = layoutPng({ ...spec, caption: ['Area'] }, measure);
    expect(short.width).toBe(480 + 48);
  });

  it('leaves no gap for a legend that is not there', () => {
    const withLegend = layoutPng(spec, measure);
    const without = layoutPng({ ...spec, legend: undefined }, measure);
    expect(without.figureY).toBeLessThan(withLegend.figureY);
  });
});
