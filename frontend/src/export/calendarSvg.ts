import type { CalendarResponse } from '../api/types';
import { buildCells, yearsNewestFirst } from '../calendar/cells';
import type { CalendarMode } from '../components/BurnCalendar';
import { formatCompact, formatNumber, formatSignedPercent, MONTH_INITIALS } from '../labels';
import {
  ANOMALY_BREAKS,
  ANOMALY_RAMP,
  anomalyColor,
  COUNT_RAMP,
  countColor,
  quantileBreaks,
  ZERO_COLOR,
} from '../theme/scales';

// The burn calendar redrawn as a standalone SVG for the PNG export (requirement F24).
// On the page the calendar is an HTML grid, which cannot be turned into an image directly,
// so the export draws the same data with the same colors. Pure text in, text out: testable.

/** An SVG drawing as text, with its size in pixels. */
export interface SvgFigure {
  markup: string;
  width: number;
  height: number;
}

/** Fonts every system has: an image cannot load the web font of the page. */
export const EXPORT_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
export const INK = '#16212b';
export const MUTED = '#5d6975';
const LINE = '#aab4be';

const YEAR_WIDTH = 40;
const CELL_WIDTH = 26;
const CELL_HEIGHT = 16;
const GAP = 2;
const TOTAL_WIDTH = 74;
const HEADER_HEIGHT = 18;
const STEP_X = CELL_WIDTH + GAP;
const STEP_Y = CELL_HEIGHT + GAP;
const GRID_WIDTH = 12 * STEP_X - GAP;
const WIDTH = YEAR_WIDTH + GRID_WIDTH + TOTAL_WIDTH;
/** Distance between the two note lines of the legend. */
const LEGEND_NOTE_STEP = 14;

const text = (x: number, y: number, content: string | number, attributes = '') =>
  `<text x="${x}" y="${y}" ${attributes}>${content}</text>`;

/** The legend under the grid: the classes of the scale with their boundaries. */
function legend(mode: CalendarMode, breaks: readonly number[], top: number): string[] {
  const colors =
    mode === 'count'
      ? Array.from({ length: breaks.length + 1 }, (_, index) =>
          breaks.length === 0
            ? COUNT_RAMP[COUNT_RAMP.length - 1]
            : COUNT_RAMP[Math.round((index / breaks.length) * (COUNT_RAMP.length - 1))],
        )
      : [...ANOMALY_RAMP];
  const labels =
    mode === 'count' ? breaks.map(formatCompact) : ANOMALY_BREAKS.map(formatSignedPercent);
  const boxWidth = Math.floor(GRID_WIDTH / colors.length);

  const parts = [
    text(
      YEAR_WIDTH,
      top + 10,
      mode === 'count'
        ? 'Fire detections per month, VIIRS-equivalent'
        : 'Difference from the median of the same calendar month',
      `fill="${INK}"`,
    ),
  ];
  colors.forEach((color, index) => {
    const x = YEAR_WIDTH + index * boxWidth;
    parts.push(
      `<rect x="${x}" y="${top + 18}" width="${boxWidth - GAP}" height="10" fill="${color}" stroke="${INK}" stroke-opacity="0.12"/>`,
    );
    // A boundary sits between two boxes, so its label is centered on the gap.
    if (index < labels.length) {
      parts.push(
        text(
          x + boxWidth - GAP / 2,
          top + 41,
          labels[index],
          `fill="${MUTED}" text-anchor="middle"`,
        ),
      );
    }
  });
  // Two short lines: one long line would run past the edge of the drawing.
  const notes =
    mode === 'count'
      ? [
          'White: no fires. Dashed outline: no data.',
          'Corner mark: preliminary. Dark lines: change of sensor.',
        ]
      : [
          'Blue: below the median. Orange: above.',
          'Hatched: not compared. Dark lines: change of sensor.',
        ];
  notes.forEach((note, index) => {
    parts.push(text(YEAR_WIDTH, top + 58 + index * LEGEND_NOTE_STEP, note, `fill="${MUTED}"`));
  });
  return parts;
}

/** The year-by-month grid with yearly totals and a legend, as a standalone SVG. */
export function calendarSvg(calendar: CalendarResponse, mode: CalendarMode): SvgFigure {
  const { months, yearly, monthly_baseline: baselines } = calendar;
  const years = yearsNewestFirst(months);
  const byKey = new Map(months.map((month) => [`${month.year}-${month.month}`, month]));
  const breaks = quantileBreaks(months.filter((m) => !m.partial).map((m) => m.value));
  const cellOf = buildCells(months, (month) =>
    mode === 'count' ? countColor(month.value, breaks) : anomalyColor(month.anomaly_pct),
  );
  const totals = new Map(yearly.map((year) => [year.year, year]));

  const parts: string[] = [];
  const seams: string[] = [];
  const xOf = (month: number) => YEAR_WIDTH + (month - 1) * STEP_X;

  MONTH_INITIALS.forEach((initial, index) => {
    parts.push(
      text(xOf(index + 1) + CELL_WIDTH / 2, 12, initial, `fill="${MUTED}" text-anchor="middle"`),
    );
  });
  parts.push(text(WIDTH, 12, 'Total', `fill="${MUTED}" text-anchor="end"`));

  years.forEach((year, row) => {
    const y = HEADER_HEIGHT + row * STEP_Y;
    parts.push(text(0, y + 12, year, `fill="${INK}"`));

    for (let month = 1; month <= 12; month += 1) {
      const x = xOf(month);
      const cell = cellOf(year, month);
      if (!cell) {
        parts.push(
          `<rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL_WIDTH - 1}" height="${CELL_HEIGHT - 1}" fill="none" stroke="${LINE}" stroke-dasharray="2 2"/>`,
        );
        continue;
      }
      parts.push(
        `<rect x="${x}" y="${y}" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" fill="${cell.color ?? 'url(#uncompared)'}" stroke="${INK}" stroke-opacity="0.1"/>`,
      );
      if (byKey.get(`${year}-${month}`)?.preliminary) {
        const right = x + CELL_WIDTH;
        parts.push(`<path d="M${right - 7} ${y}H${right}V${y + 7}Z" fill="${INK}"/>`);
      }
      // Seams are drawn last and exactly in the gaps, so no cell covers them.
      if (cell.seamLeft) {
        seams.push(`M${x - GAP / 2} ${y - GAP / 2}V${y + CELL_HEIGHT + GAP / 2}`);
      }
      if (cell.seamBottom) {
        const below = y + CELL_HEIGHT + GAP / 2;
        seams.push(`M${x - GAP / 2} ${below}H${x + CELL_WIDTH + GAP / 2}`);
      }
    }

    const total = totals.get(year);
    if (total) {
      parts.push(
        text(
          WIDTH,
          y + 12,
          formatNumber(Math.round(total.total)),
          // Incomplete years are grayed, as on the page.
          `fill="${total.complete ? INK : MUTED}" text-anchor="end"`,
        ),
      );
    }
  });

  let bottom = HEADER_HEIGHT + years.length * STEP_Y;
  if (mode === 'count') {
    // The long-term median of each calendar month, as the last row of the grid.
    bottom += 4;
    parts.push(text(0, bottom + 12, 'Median', `fill="${MUTED}"`));
    for (const baseline of baselines) {
      parts.push(
        `<rect x="${xOf(baseline.month)}" y="${bottom}" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" fill="${baseline.median > 0 ? countColor(baseline.median, breaks) : ZERO_COLOR}" stroke="${INK}" stroke-opacity="0.1"/>`,
      );
    }
    bottom += STEP_Y;
  }
  if (seams.length > 0) {
    parts.push(`<path d="${seams.join('')}" fill="none" stroke="${INK}" stroke-width="${GAP}"/>`);
  }

  parts.push(...legend(mode, breaks, bottom + 10));
  const height = bottom + 10 + 64 + LEGEND_NOTE_STEP;

  const markup = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="${EXPORT_FONT}" font-size="11">`,
    '<defs><pattern id="uncompared" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">',
    `<rect width="5" height="5" fill="#ffffff"/><line x1="0" y1="0" x2="0" y2="5" stroke="${LINE}" stroke-width="2.5"/>`,
    '</pattern></defs>',
    ...parts,
    '</svg>',
  ].join('');
  return { markup, width: WIDTH, height };
}
