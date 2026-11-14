import { useState } from 'react';
import { fetchCalendarCsv, fetchPointsCsv } from '../api/queries';
import type { CalendarResponse, CurrentResponse, Meta, MonthValue } from '../api/types';
import { calendarSvg } from '../export/calendarSvg';
import { captionLines, nowCaptionLines, SOURCE_LINE } from '../export/caption';
import { chartSvg } from '../export/chartSvg';
import {
  exportDates,
  exportFileName,
  hotspotsFileName,
  monthDates,
  monthFileName,
  nowFileName,
  saveBlob,
  type ExportScope,
} from '../export/files';
import { renderPng, type LegendItem, type PngSpec } from '../export/png';
import { formatNumber } from '../labels';
import type { CalendarMode } from './BurnCalendar';
import styles from './Downloads.module.css';
import { ErrorNote } from './ErrorNote';

interface DownloadsProps {
  scope: ExportScope;
  /** The name of the area as the panel shows it. */
  areaName: string;
  calendar: CalendarResponse;
  meta: Meta;
  /** The calendar image is saved in the mode that is on screen. */
  mode: CalendarMode;
  /** The current month, once it has loaded: its chart can be saved as well. */
  current?: CurrentResponse;
}

/** A chart of the panel that can be saved as an image, found by its `data-figure` mark. */
function chartFigure(name: string): { figure: HTMLElement; svg: SVGSVGElement } {
  const figure = document.querySelector<HTMLElement>(`[data-figure="${name}"]`);
  const svg = figure?.querySelector<SVGSVGElement>('svg');
  if (!figure || !svg) throw new Error('The chart is not on the page.');
  return { figure, svg };
}

/** A color the chart stylesheet defines, so the legend of the image matches the chart. */
const chartColor = (figure: HTMLElement, name: string, fallback: string) =>
  window.getComputedStyle(figure).getPropertyValue(name).trim() || fallback;

/**
 * Rows of the hot spot file per detection of the harmonized record, by the lead source of
 * the month. The file has every detection of every sensor, low confidence included, while
 * the record counts one sensor: a MODIS month has fewer rows (its coefficient is above 1),
 * a VIIRS month more (MODIS adds its own, and NOAA-20 too from 2018). Measured on the
 * example areas and rounded up, so the estimate errs on the high side.
 */
const ROWS_PER_DETECTION: Record<string, number> = {
  MODIS_T: 0.3,
  MODIS_TA: 0.5,
  VIIRS_SNPP: 2,
  VIIRS_N20: 3,
};
const NOAA20_FROM = 2018;

const rowsPerDetection = (month: MonthValue) =>
  month.source === 'VIIRS_SNPP' && month.year >= NOAA20_FROM
    ? 3
    : (ROWS_PER_DETECTION[month.source] ?? 3);

/** Days from one ISO date to another, both included. */
const daysBetween = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;

/** The likely number of rows of the hot spot file for these dates, from the monthly values. */
function estimateRows(
  calendar: CalendarResponse,
  dates: { start_date: string; end_date: string },
  meta: Meta,
): number {
  let rows = 0;
  for (const month of calendar.months) {
    const { start_date, end_date } = monthDates(month.year, month.month, meta);
    // ISO dates compare correctly as strings.
    const from = start_date > dates.start_date ? start_date : dates.start_date;
    const to = end_date < dates.end_date ? end_date : dates.end_date;
    if (from > to) continue;
    const share = daysBetween(from, to) / daysBetween(start_date, end_date);
    rows += month.value * rowsPerDetection(month) * share;
  }
  return rows;
}

/** The latest complete month of the period, or its last month when none is complete. */
function latestMonth(calendar: CalendarResponse, scope: ExportScope): MonthValue | undefined {
  const months = calendar.months.filter(
    (month) => month.year >= scope.startYear && month.year <= scope.endYear,
  );
  return months.filter((month) => !month.partial).at(-1) ?? months.at(-1);
}

/**
 * Downloads of the panel (requirements F22 to F24): the hot spots and the monthly table as
 * CSV, the calendar and the charts as PNG with a caption that names the area, the period
 * and the data source.
 */
export function Downloads({ scope, areaName, calendar, meta, mode, current }: DownloadsProps) {
  // Which download is under way, and what the last failed one said.
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; error: Error } | null>(null);

  // The image shows the harmonized record: the "original sensors" view is saved as detections.
  const imageMode = mode === 'anomaly' ? 'anomaly' : 'count';
  const caption = captionLines(scope, areaName, calendar, meta);
  // The hot spot file covers the latest complete month of the period unless the dates are
  // set by hand: the whole record of a large area has millions of rows, far above the limit.
  // Dates typed for one period do not carry over to another.
  const whole = exportDates(scope, meta);
  const wholeKey = `${whole.start_date}_${whole.end_date}`;
  const latest = latestMonth(calendar, scope);
  const latestDates = latest ? monthDates(latest.year, latest.month, meta) : whole;
  const [typed, setTyped] = useState<{ key: string; start: string; end: string } | null>(null);
  const dates =
    typed?.key === wholeKey ? { start_date: typed.start, end_date: typed.end } : latestDates;
  const same = (other: { start_date: string; end_date: string }) =>
    dates.start_date === other.start_date && dates.end_date === other.end_date;
  const datesValid =
    dates.start_date !== '' && dates.end_date !== '' && dates.start_date <= dates.end_date;
  const setDate = (edge: 'start' | 'end', value: string) =>
    setTyped({ key: wholeKey, start: dates.start_date, end: dates.end_date, [edge]: value });
  const setDates = ({ start_date, end_date }: { start_date: string; end_date: string }) =>
    setTyped({ key: wholeKey, start: start_date, end: end_date });
  // Above the row limit the server refuses the file, so it is not offered.
  const overLimit = datesValid && estimateRows(calendar, dates, meta) > meta.limits.max_export_rows;

  /** Runs one download: one at a time, with its error kept next to its button. */
  const run = async (id: string, make: () => Promise<{ blob: Blob; name: string }>) => {
    setBusy(id);
    setFailure(null);
    try {
      const { blob, name } = await make();
      saveBlob(blob, name);
    } catch (error) {
      setFailure({ id, error: error instanceof Error ? error : new Error(String(error)) });
    } finally {
      setBusy(null);
    }
  };

  const png = async (kind: string, spec: PngSpec) => ({
    blob: await renderPng(spec),
    name: exportFileName(kind, scope, 'png'),
  });

  const actions: { id: string; label: string; run: () => Promise<{ blob: Blob; name: string }> }[] =
    [
      {
        id: 'calendar-csv',
        label: 'Monthly table (CSV)',
        run: async () => ({
          blob: await fetchCalendarCsv({
            geometry: scope.geometry,
            start_year: scope.startYear,
            end_year: scope.endYear,
          }),
          name: exportFileName('calendar', scope, 'csv'),
        }),
      },
      {
        id: 'points-csv',
        label: 'Hot spots (CSV)',
        run: async () => ({
          blob: await fetchPointsCsv({ geometry: scope.geometry, ...dates }),
          name:
            latest && same(latestDates)
              ? monthFileName(scope, latest.year, latest.month)
              : hotspotsFileName(scope, dates, meta),
        }),
      },
      {
        id: 'calendar-png',
        label: 'Calendar (PNG)',
        run: () =>
          png(imageMode === 'count' ? 'calendar' : 'calendar-anomaly', {
            title:
              imageMode === 'count'
                ? 'Burn calendar: fire detections by month'
                : 'Burn calendar: difference from the median by month',
            figure: calendarSvg(calendar, meta.sources, imageMode),
            caption,
          }),
      },
      {
        id: 'season-png',
        label: 'Season profile (PNG)',
        run: () => {
          const { figure, svg } = chartFigure('season-profile');
          const legend: LegendItem[] = [
            {
              kind: 'line',
              color: chartColor(figure, '--series-main', '#c85d02'),
              label: figure.dataset.figureYear ?? 'Chosen year',
            },
            {
              kind: 'dash',
              color: chartColor(figure, '--series-median', '#5d6975'),
              label: 'Median of the baseline years',
            },
            { kind: 'box', color: '#d9dde1', label: '10th to 90th percentile' },
          ];
          return png('season-profile', {
            title: figure.dataset.figureTitle ?? 'Season profile',
            legend,
            figure: chartSvg(svg),
            caption,
          });
        },
      },
      {
        id: 'yearly-png',
        label: 'Yearly totals (PNG)',
        run: () => {
          const { figure, svg } = chartFigure('yearly-totals');
          const main = chartColor(figure, '--series-main', '#c85d02');
          const legend: LegendItem[] = [
            { kind: 'box', color: main, label: 'Yearly total' },
            { kind: 'hatch', color: main, label: 'Incomplete year' },
          ];
          if (calendar.summary.trend_line) {
            legend.push({ kind: 'line', color: '#16212b', label: 'Trend' });
          }
          return png('yearly-totals', {
            title: figure.dataset.figureTitle ?? 'Fire detections per year',
            legend,
            figure: chartSvg(svg),
            caption,
          });
        },
      },
    ];

  // The current month is a separate request: its image is offered once it is there.
  if (current) {
    actions.push({
      id: 'now-png',
      label: 'Current month (PNG)',
      run: async () => {
        const { figure, svg } = chartFigure('current-month');
        return {
          blob: await renderPng({
            title: figure.dataset.figureTitle ?? 'Current month',
            legend: [
              {
                kind: 'line',
                color: chartColor(figure, '--series-main', '#c85d02'),
                label: 'This month',
              },
              {
                kind: 'dash',
                color: chartColor(figure, '--series-median', '#5d6975'),
                label: 'Median of the same days in the baseline years',
              },
            ],
            figure: chartSvg(svg),
            caption: nowCaptionLines(scope, areaName, calendar, meta, current),
          }),
          name: nowFileName(scope, current.year, current.month),
        };
      },
    });
  }

  return (
    <div className={styles.downloads}>
      <div className={styles.buttons} role="group" aria-label="Files to download">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={busy !== null || (action.id === 'points-csv' && (!datesValid || overLimit))}
            aria-busy={busy === action.id}
            onClick={() => void run(action.id, action.run)}
          >
            {busy === action.id ? 'Preparing…' : action.label}
          </button>
        ))}
      </div>

      <fieldset className={styles.dates}>
        <legend>Dates of the hot spot file</legend>
        <label>
          From{' '}
          <input
            type="date"
            value={dates.start_date}
            min={whole.start_date}
            max={whole.end_date}
            onChange={(event) => setDate('start', event.target.value)}
          />
        </label>
        <label>
          to{' '}
          <input
            type="date"
            value={dates.end_date}
            min={whole.start_date}
            max={whole.end_date}
            onChange={(event) => setDate('end', event.target.value)}
          />
        </label>
        {latest && !same(latestDates) && (
          <button type="button" onClick={() => setTyped(null)}>
            Latest month
          </button>
        )}
        {!same(whole) && (
          <button type="button" onClick={() => setDates(whole)}>
            Whole period
          </button>
        )}
        {!datesValid && <span role="alert">The first date must not be after the last one.</span>}
      </fieldset>

      {failure && <ErrorNote error={failure.error} />}

      <ul className={styles.notes}>
        <li>
          Hot spots: every detection of the chosen dates with its sensor and its weight in the
          harmonized record, up to {formatNumber(meta.limits.max_export_rows)} rows. Shorten the
          dates for a large area.
          {overLimit && (
            <strong> These dates likely have more: shorten them or reduce the area.</strong>
          )}
        </li>
        <li>Images carry the area, the period and the data source in their caption.</li>
        <li>{SOURCE_LINE}</li>
      </ul>
    </div>
  );
}
