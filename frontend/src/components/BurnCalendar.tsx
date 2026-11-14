import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CalendarResponse, MonthValue, SourceInfo } from '../api/types';
import { buildCells, sourceSideLabels, yearsNewestFirst } from '../calendar/cells';
import {
  describeBaseline,
  describeMonth,
  monthSentence,
  type CellDescription,
} from '../calendar/describe';
import { describeRawMonth, rawLead, rawMonthSentence, rawYearTotals } from '../calendar/raw';
import {
  formatCompact,
  formatNumber,
  formatSignedPercent,
  MONTH_INITIALS,
  monthName,
} from '../labels';
import {
  ANOMALY_BREAKS,
  ANOMALY_MIDPOINT,
  ANOMALY_RAMP,
  anomalyColor,
  classOf,
  COUNT_RAMP,
  countColor,
  quantileBreaks,
  ZERO_COLOR,
} from '../theme/scales';
import styles from './BurnCalendar.module.css';
import { ScaleLegend } from './ScaleLegend';

/**
 * What the cell color shows: how many detections, how far the month is from its median,
 * or what the lead sensor recorded before harmonization (F19).
 */
export type CalendarMode = 'count' | 'anomaly' | 'raw';

const MODES: readonly { mode: CalendarMode; label: string }[] = [
  { mode: 'count', label: 'Detections' },
  { mode: 'anomaly', label: 'Anomaly' },
  { mode: 'raw', label: 'Original sensors' },
];

interface BurnCalendarProps {
  calendar: CalendarResponse;
  sources: readonly SourceInfo[];
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  /** The months whose hot spots are on the map, as "2020-09" (F13). */
  selectedMonths?: ReadonlySet<string>;
  /** Called when the user picks a month by a click or with Enter. */
  onSelectMonth?: (month: MonthValue) => void;
}

/** What the tooltip shows and where it sits, in pixels inside the calendar. */
interface Tip {
  /** The response the tooltip was opened for: it must not outlive those numbers. */
  calendar: CalendarResponse;
  description: CellDescription;
  left: number;
  cellTop: number;
  cellBottom: number;
  below: boolean;
}

const NO_MONTHS: ReadonlySet<string> = new Set();

const TIP_WIDTH = 248;
/** Room the tooltip needs above a cell to open upward. */
const TIP_ROOM = 190;

const keyOf = (year: number, month: number) => year * 12 + (month - 1);
const cellId = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/**
 * The burn calendar: a year-by-month heat grid with yearly totals on the right and
 * the long-term median of each month at the bottom (F7, F8). Hovering or focusing a
 * cell opens a tooltip with the exact numbers (F9). Arrow keys move between cells.
 * The mode switch recolors the same data by its difference from the median (F10).
 */
export function BurnCalendar({
  calendar,
  sources,
  mode,
  onModeChange,
  selectedMonths = NO_MONTHS,
  onSelectMonth,
}: BurnCalendarProps) {
  const { months, yearly, monthly_baseline: baselines } = calendar;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [openTip, setTip] = useState<Tip | null>(null);
  // When another area or period arrives while a tooltip is open (the pointer rests on a
  // cell, or a touch screen left it there), the old numbers would describe the new cells.
  const tip = openTip?.calendar === calendar ? openTip : null;
  // The one cell that Tab reaches; arrow keys move it (the "roving tabindex" pattern).
  const [cursor, setCursor] = useState<string | null>(null);

  const years = useMemo(() => yearsNewestFirst(months), [months]);
  const byKey = useMemo(() => new Map(months.map((m) => [keyOf(m.year, m.month), m])), [months]);
  // The partial current month is left out of the class boundaries: it is low by definition.
  const breaks = useMemo(
    () => quantileBreaks(months.filter((m) => !m.partial).map((m) => m.value)),
    [months],
  );
  // The raw counts come with their own request. Until they arrive, the calendar that is
  // already on screen stays as the detections view.
  const hasRaw = useMemo(() => months.some((m) => m.raw !== undefined), [months]);
  const view: CalendarMode = mode === 'raw' && !hasRaw ? 'count' : mode;
  // Switching the mode only changes colors. The raw view keeps the classes of the
  // harmonized record, so a paler cell there means fewer detections were recorded.
  const cellOf = useMemo(
    () =>
      buildCells(months, sources, (month) => {
        if (view === 'anomaly') return anomalyColor(month.anomaly_pct);
        if (view === 'count') return countColor(month.value, breaks);
        const lead = rawLead(month);
        return lead === null ? null : countColor(lead, breaks);
      }),
    [months, sources, breaks, view],
  );
  const rawTotals = useMemo(() => rawYearTotals(months), [months]);
  const describe = view === 'raw' ? describeRawMonth : describeMonth;
  const sideLabels = useMemo(() => sourceSideLabels(sources, years), [sources, years]);
  const totals = useMemo(() => new Map(yearly.map((year) => [year.year, year])), [yearly]);

  if (years.length === 0) return null;

  const newest = months[months.length - 1];
  const tabbable = cursor ?? cellId(newest.year, newest.month);
  const firstYearRow = 2;
  const medianRow = firstYearRow + years.length;
  const rowOf = (year: number) => firstYearRow + years.indexOf(year);
  /** The total of a year in the view on screen: harmonized, or as the sensors recorded. */
  const yearTotal = (year: number, harmonized: number) =>
    view === 'raw' ? (rawTotals.get(year) ?? 0) : harmonized;

  const showTip = (target: HTMLElement, description: CellDescription) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const frame = wrap.getBoundingClientRect();
    const cell = target.getBoundingClientRect();
    setTip({
      calendar,
      description,
      // Centered on the cell, but kept inside the calendar.
      left: Math.max(
        0,
        Math.min(cell.left - frame.left + cell.width / 2 - TIP_WIDTH / 2, frame.width - TIP_WIDTH),
      ),
      cellTop: cell.top - frame.top,
      cellBottom: cell.bottom - frame.top,
      below: cell.top - frame.top < TIP_ROOM,
    });
  };

  /** Moves focus to the nearest cell with data in the given direction. */
  const moveFocus = (year: number, month: number, stepYear: number, stepMonth: number) => {
    let nextYear = year + stepYear;
    let nextMonth = month + stepMonth;
    while (
      nextMonth >= 1 &&
      nextMonth <= 12 &&
      nextYear >= years[years.length - 1] &&
      nextYear <= years[0]
    ) {
      if (byKey.has(keyOf(nextYear, nextMonth))) {
        const id = cellId(nextYear, nextMonth);
        setCursor(id);
        wrapRef.current?.querySelector<HTMLElement>(`[data-month="${id}"]`)?.focus();
        return;
      }
      nextYear += stepYear;
      nextMonth += stepMonth;
    }
  };

  const handleKey = (event: KeyboardEvent<HTMLElement>, month: MonthValue) => {
    // Rows run from the newest year down, so "up" means a later year.
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [1, 0],
      ArrowDown: [-1, 0],
    };
    if (event.key in steps) {
      event.preventDefault();
      const [stepYear, stepMonth] = steps[event.key];
      moveFocus(month.year, month.month, stepYear, stepMonth);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(month.year, 0, 0, 1);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveFocus(month.year, 13, 0, -1);
    } else if ((event.key === 'Enter' || event.key === ' ') && onSelectMonth) {
      event.preventDefault();
      onSelectMonth(month);
    } else if (event.key === 'Escape') {
      setTip(null);
    }
  };

  return (
    <div className={styles.calendar}>
      <div className={styles.modes} role="group" aria-label="Calendar mode">
        {MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            aria-pressed={mode === item.mode}
            onClick={() => onModeChange(item.mode)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view !== 'anomaly' ? (
        <ScaleLegend
          title={
            view === 'raw'
              ? 'Fire detections per month, as each sensor recorded them'
              : 'Fire detections per month, VIIRS-equivalent'
          }
          colors={COUNT_RAMP}
          boundaries={breaks.map(formatNumber)}
          ends={['fewer', 'more']}
          extras={[
            { color: ZERO_COLOR, label: 'No fires' },
            { color: null, label: 'No data' },
          ]}
        />
      ) : (
        <ScaleLegend
          title="Difference from the median of the same calendar month"
          colors={ANOMALY_RAMP}
          boundaries={ANOMALY_BREAKS.map(formatSignedPercent)}
          ends={['below median', 'above median']}
          extras={[
            { color: null, hatched: true, label: 'Not compared' },
            { color: null, label: 'No data' },
          ]}
          note="Color is the difference from the median in percent. The level in Now is a percentile, so the two can differ."
        />
      )}

      <div className={styles.wrap} ref={wrapRef} onMouseLeave={() => setTip(null)}>
        <div
          className={styles.grid}
          role="grid"
          aria-label={
            view === 'count'
              ? `Fire detections by month, ${years[years.length - 1]} to ${years[0]}. Darker cells mean more detections.`
              : view === 'anomaly'
                ? `Fire anomalies by month, ${years[years.length - 1]} to ${years[0]}. Blue is below the median, orange is above.`
                : `Fire detections by month as the sensors recorded them, ${years[years.length - 1]} to ${years[0]}. Darker cells mean more detections.`
          }
          style={{ gridTemplateRows: `auto repeat(${years.length}, var(--cell-height)) auto` }}
        >
          <div role="row" className={styles.row}>
            <span
              role="columnheader"
              className={styles.corner}
              style={{ gridColumn: 1, gridRow: 1 }}
            >
              <span className={styles.srOnly}>Year</span>
            </span>
            {MONTH_INITIALS.map((initial, index) => (
              <span
                key={index}
                role="columnheader"
                aria-label={monthName(index + 1)}
                className={styles.month}
                style={{ gridColumn: index + 2, gridRow: 1 }}
              >
                {initial}
              </span>
            ))}
            <span
              role="columnheader"
              className={styles.totalHead}
              style={{ gridColumn: 14, gridRow: 1 }}
            >
              Total
            </span>
          </div>

          {years.map((year) => {
            const total = totals.get(year);
            return (
              <div role="row" className={styles.row} key={year}>
                <span
                  role="rowheader"
                  className={styles.year}
                  style={{ gridColumn: 1, gridRow: rowOf(year) }}
                >
                  {year}
                </span>
                {Array.from({ length: 12 }, (_, index) => {
                  const month = index + 1;
                  const data = byKey.get(keyOf(year, month));
                  const cell = cellOf(year, month);
                  const position = { gridColumn: month + 1, gridRow: rowOf(year) };
                  if (!data || !cell) {
                    return (
                      <span
                        key={month}
                        role="gridcell"
                        aria-label={`${monthName(month)} ${year}: no data`}
                        className={styles.empty}
                        style={position}
                      />
                    );
                  }
                  const id = cellId(year, month);
                  const seam = [cell.seamLeft && 'left', cell.seamBottom && 'bottom']
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <span
                      key={month}
                      role="gridcell"
                      tabIndex={id === tabbable ? 0 : -1}
                      aria-label={view === 'raw' ? rawMonthSentence(data) : monthSentence(data)}
                      aria-selected={onSelectMonth ? selectedMonths.has(id) : undefined}
                      data-selected={selectedMonths.has(id) || undefined}
                      className={styles.cell}
                      style={{ ...position, background: cell.color ?? undefined }}
                      data-month={id}
                      data-seam={seam || undefined}
                      data-preliminary={data.preliminary || undefined}
                      data-level={
                        view === 'anomaly' && data.anomaly_pct !== null
                          ? classOf(data.anomaly_pct, ANOMALY_BREAKS)
                          : undefined
                      }
                      data-uncompared={
                        (view === 'anomaly' && data.anomaly_pct === null) || undefined
                      }
                      onMouseEnter={(event) => showTip(event.currentTarget, describe(data))}
                      onFocus={(event) => {
                        setCursor(id);
                        showTip(event.currentTarget, describe(data));
                      }}
                      onClick={onSelectMonth ? () => onSelectMonth(data) : undefined}
                      onBlur={() => setTip(null)}
                      onKeyDown={(event) => handleKey(event, data)}
                    />
                  );
                })}
                <span
                  role="gridcell"
                  className={
                    total?.complete ? styles.total : `${styles.total} ${styles.incomplete}`
                  }
                  style={{ gridColumn: 14, gridRow: rowOf(year) }}
                  aria-label={
                    total
                      ? `${year} total: ${formatNumber(Math.round(yearTotal(year, total.total)))}${total.complete ? '' : ', incomplete year'}`
                      : `${year} total: no data`
                  }
                  title={total && !total.complete ? 'Incomplete year' : undefined}
                >
                  {total ? formatNumber(Math.round(yearTotal(year, total.total))) : ''}
                </span>
              </div>
            );
          })}

          <div role="row" className={styles.row}>
            <span
              role="rowheader"
              className={styles.medianHead}
              style={{ gridColumn: 1, gridRow: medianRow }}
            >
              Median
            </span>
            {baselines.map((baseline) => (
              <span
                key={baseline.month}
                role="gridcell"
                tabIndex={-1}
                aria-label={`${monthName(baseline.month)} median: ${formatNumber(baseline.median)}`}
                className={styles.median}
                style={{
                  gridColumn: baseline.month + 1,
                  gridRow: medianRow,
                  // The median is the zero of the anomaly scale, so it takes the neutral color there.
                  borderTopColor:
                    view === 'anomaly'
                      ? ANOMALY_RAMP[ANOMALY_MIDPOINT]
                      : countColor(baseline.median, breaks),
                }}
                data-median={baseline.month}
                onMouseEnter={(event) => showTip(event.currentTarget, describeBaseline(baseline))}
              >
                <span className={styles.medianValue}>{formatCompact(baseline.median)}</span>
              </span>
            ))}
          </div>

          {sideLabels.map((side) => (
            <span
              key={side.year}
              className={styles.side}
              style={{ gridColumn: 15, gridRow: rowOf(side.year) }}
              aria-hidden="true"
            >
              {side.text}
            </span>
          ))}
        </div>

        {tip && (
          <div
            className={styles.tip}
            role="tooltip"
            aria-hidden="true"
            style={{
              left: tip.left,
              width: TIP_WIDTH,
              ...(tip.below
                ? { top: tip.cellBottom + 8 }
                : { top: tip.cellTop - 8, transform: 'translateY(-100%)' }),
            }}
          >
            <p className={styles.tipTitle}>{tip.description.title}</p>
            <dl className={styles.tipLines}>
              {tip.description.lines.map((line) => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
            {tip.description.notes.map((note) => (
              <p key={note} className={styles.tipNote}>
                {note}
              </p>
            ))}
          </div>
        )}
      </div>

      {view === 'raw' ? (
        <p className={styles.caption}>
          Every month shows what its lead sensor recorded, without conversion. The colors keep the
          scale of the harmonized record, so the step at the dark lines is the difference between
          the sensors, not a change in fire activity. The medians at the bottom are those of the
          harmonized record.
        </p>
      ) : (
        <p className={styles.caption}>
          Dark lines are the seams of the record: the lead sensor changes there. Colors run across
          them without a jump because every sensor is converted to the same VIIRS scale. Totals in
          gray are for incomplete years.
        </p>
      )}
      {onSelectMonth && (
        <p className={styles.caption}>Click a month to see its hot spots on the map.</p>
      )}
    </div>
  );
}
