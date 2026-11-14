import { useState } from 'react';
import { fetchCalendarCsv, fetchPointsCsv } from '../api/queries';
import type { CalendarResponse, CurrentResponse, Meta } from '../api/types';
import { calendarSvg } from '../export/calendarSvg';
import { captionLines, nowCaptionLines, SOURCE_LINE } from '../export/caption';
import { chartSvg } from '../export/chartSvg';
import {
  exportDates,
  exportFileName,
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
  const dates = exportDates(scope, meta);
  // The calendar counts VIIRS-equivalent detections, close to the number of rows in the
  // hot spot file. Above the limit the server refuses, so the user is told beforehand.
  const overLimit = calendar.summary.total > meta.limits.max_export_rows;

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
          name: exportFileName('hotspots', scope, 'csv'),
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
            figure: calendarSvg(calendar, imageMode),
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
            disabled={busy !== null}
            aria-busy={busy === action.id}
            onClick={() => void run(action.id, action.run)}
          >
            {busy === action.id ? 'Preparing…' : action.label}
          </button>
        ))}
      </div>

      {failure && <ErrorNote error={failure.error} />}

      <ul className={styles.notes}>
        <li>
          Hot spots: every detection from {dates.start_date} to {dates.end_date} with its sensor and
          its weight in the harmonized record, up to {formatNumber(meta.limits.max_export_rows)}{' '}
          rows.
          {overLimit && (
            <strong> This period likely has more: choose fewer years or a smaller area.</strong>
          )}
        </li>
        <li>Images carry the area, the period and the data source in their caption.</li>
        <li>{SOURCE_LINE}</li>
      </ul>
    </div>
  );
}
