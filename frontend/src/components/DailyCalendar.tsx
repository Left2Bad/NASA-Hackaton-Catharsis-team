import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useDaily } from '../api/queries';
import type { DailyResponse, Geometry } from '../api/types';
import { busiestDay, dayCells, daySentence, stepDay } from '../calendar/daily';
import { formatNumber, monthName } from '../labels';
import { COUNT_RAMP, countColor, quantileBreaks, ZERO_COLOR } from '../theme/scales';
import styles from './DailyCalendar.module.css';
import { ErrorNote } from './ErrorNote';
import { LoadingNote } from './LoadingNote';
import { ScaleLegend } from './ScaleLegend';

interface DailyCalendarProps {
  geometry: Geometry;
  /** Years that can be chosen, newest first. */
  years: readonly number[];
}

/** Day numbers written above the grid: enough to find a date, few enough to stay readable. */
const DAY_TICKS = [1, 5, 10, 15, 20, 25, 30];

interface DayGridProps {
  daily: DailyResponse;
}

/** The grid itself: a row per month, a column per day, colored by classes at quantiles. */
function DayGrid({ daily }: DayGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => dayCells(daily.days), [daily]);
  const breaks = useMemo(() => quantileBreaks(daily.days.map((day) => day.value)), [daily]);
  const busiest = useMemo(() => busiestDay(daily.days), [daily]);
  const total = useMemo(() => daily.days.reduce((sum, day) => sum + day.value, 0), [daily]);
  // The day the readout describes: the one under the pointer or the focus, else the busiest.
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked !== null && picked < cells.length ? picked : busiest;
  // The one cell that Tab reaches; arrow keys move it.
  const tabbable = active === -1 ? 0 : active;

  const handleKey = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const target = stepDay(cells, index, event.key);
    if (target === index && !/^(Arrow|Home|End)/.test(event.key)) return;
    event.preventDefault();
    setPicked(target);
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${cells[target].data.date}"]`)?.focus();
  };

  if (cells.length === 0) return <p className={styles.note}>No daily values for this year.</p>;

  return (
    <>
      <p className={styles.readout} data-testid="daily-readout" aria-live="polite">
        {active === -1 ? (
          `No fires were detected in ${daily.year}.`
        ) : (
          <>
            {picked === null && <span className={styles.readoutLabel}>Busiest day: </span>}
            {daySentence(cells[active].data)}
            <span className={styles.readoutTotal}>
              {' '}
              · {formatNumber(Math.round(total))} in {daily.year}
            </span>
          </>
        )}
      </p>

      <ScaleLegend
        title="Fire detections per day, VIIRS-equivalent"
        colors={COUNT_RAMP}
        boundaries={breaks.map(formatNumber)}
        ends={['fewer', 'more']}
        extras={[{ color: ZERO_COLOR, label: 'No fires' }]}
      />

      <div
        ref={gridRef}
        className={styles.grid}
        role="grid"
        aria-label={`Fire detections by day, ${daily.year}. A row per month, a column per day. Darker cells mean more detections.`}
        onMouseLeave={() => setPicked(null)}
      >
        <div role="row" className={styles.row}>
          <span role="columnheader" style={{ gridColumn: 1, gridRow: 1 }}>
            <span className={styles.srOnly}>Month</span>
          </span>
          {DAY_TICKS.map((day) => (
            <span
              key={day}
              role="columnheader"
              className={styles.dayHead}
              style={{ gridColumn: day + 1, gridRow: 1 }}
            >
              {day}
            </span>
          ))}
        </div>

        {Array.from({ length: 12 }, (_, index) => {
          const month = index + 1;
          return (
            <div role="row" className={styles.row} key={month}>
              <span
                role="rowheader"
                className={styles.monthHead}
                style={{ gridColumn: 1, gridRow: month + 1 }}
                aria-label={monthName(month)}
              >
                {monthName(month).slice(0, 3)}
              </span>
              {cells
                .filter((cell) => cell.month === month)
                .map((cell) => (
                  <span
                    key={cell.day}
                    role="gridcell"
                    tabIndex={cell.index === tabbable ? 0 : -1}
                    aria-label={daySentence(cell.data)}
                    className={styles.cell}
                    style={{
                      gridColumn: cell.day + 1,
                      gridRow: month + 1,
                      background: countColor(cell.data.value, breaks),
                    }}
                    data-day={cell.data.date}
                    data-active={cell.index === active || undefined}
                    onMouseEnter={() => setPicked(cell.index)}
                    onFocus={() => setPicked(cell.index)}
                    onKeyDown={(event) => handleKey(event, cell.index)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * The daily calendar of one year (requirement F14): every day of the chosen year as a
 * cell, so the weeks a fire season really took are visible. The year is chosen from a
 * list; the days come from `POST /daily`, asked only for the year on screen.
 */
export function DailyCalendar({ geometry, years }: DailyCalendarProps) {
  const [chosen, setChosen] = useState<number | null>(null);
  // A change of period can remove the chosen year: then the newest one is shown.
  const year = chosen !== null && years.includes(chosen) ? chosen : years[0];
  const daily = useDaily(year === undefined ? null : { geometry, year });

  if (year === undefined) return null;

  return (
    <div className={styles.daily}>
      <p className={styles.control}>
        <label htmlFor="daily-year">Year</label>
        <select
          id="daily-year"
          value={year}
          onChange={(event) => setChosen(Number(event.target.value))}
        >
          {years.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </p>

      {daily.isPending && <LoadingNote>Loading the days of {year}…</LoadingNote>}
      {daily.isError && (
        <ErrorNote
          error={daily.error}
          onRetry={() => void daily.refetch()}
          retrying={daily.isFetching}
        />
      )}
      {/* The key drops the picked day when another year or area arrives. */}
      {daily.data && <DayGrid key={`${daily.data.year}`} daily={daily.data} />}

      <p className={styles.note}>
        Every cell is one day of the harmonized record. The classes are set for this year alone, so
        colors cannot be compared between years: use the calendar above for that.
      </p>
    </div>
  );
}
