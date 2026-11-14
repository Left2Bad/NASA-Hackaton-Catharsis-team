import { useId, useMemo, useState, type PointerEvent } from 'react';
import type { CalendarResponse } from '../api/types';
import { yearsNewestFirst } from '../calendar/cells';
import { peakIndex, profileRows, type ProfileRow } from '../calendar/series';
import { linePath, niceScale, tickFormat } from '../charts/scale';
import { useCursor } from '../charts/useCursor';
import { useElementWidth } from '../hooks/useElementWidth';
import { formatNumber, MONTH_INITIALS, monthName } from '../labels';
import styles from './Chart.module.css';

const HEIGHT = 200;
const MARGIN = { top: 10, right: 14, bottom: 24, left: 44 };
/** Width used until the chart is measured, and in tests. */
const FALLBACK_WIDTH = 480;

/**
 * The season profile (requirement F17): what a typical year looks like month by month,
 * with one chosen year laid over it. The gray band is the usual range (10th to 90th
 * percentile of the baseline years), the dashed line is the median, the solid line is
 * the chosen year.
 *
 * The readout above the plot shows one month: the busiest month of the chosen year by
 * default, the one under the pointer on hover, the one chosen with the arrow keys on focus.
 */
export function SeasonProfile({ calendar }: { calendar: CalendarResponse }) {
  const selectId = useId();
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const years = useMemo(() => yearsNewestFirst(calendar.months), [calendar.months]);
  // The year the reader chose; when the period changes and no longer holds it,
  // the profile falls back to the newest year.
  const [chosen, setChosen] = useState<number | null>(null);
  const year = chosen !== null && years.includes(chosen) ? chosen : years[0];
  const rows = useMemo(() => profileRows(calendar, year), [calendar, year]);
  const cursor = useCursor(rows.length, peakIndex(rows));

  if (years.length === 0 || rows.length === 0) return null;

  const scale = niceScale(Math.max(...rows.map((row) => Math.max(row.p90, row.value?.value ?? 0))));
  const formatTick = tickFormat(scale.max);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + (index / (rows.length - 1)) * plotWidth;
  const y = (value: number) => MARGIN.top + (1 - value / scale.max) * plotHeight;

  const active = rows[cursor.active];
  const yearPoints = rows.flatMap((row, index) =>
    row.value ? [[x(index), y(row.value.value)] as const] : [],
  );
  // The band is one closed shape: along the 90th percentile and back along the 10th.
  const band = `${linePath(rows.map((row, index) => [x(index), y(row.p90)]))} ${linePath(
    rows.map((row, index) => [x(index), y(row.p10)] as const).reverse(),
  ).replace('M', 'L')} Z`;

  const yearValue = (row: ProfileRow) => (row.value ? formatNumber(row.value.value) : 'no data');
  const describe = (row: ProfileRow) =>
    [
      `${monthName(row.month)} ${year}: ${row.value ? `${formatNumber(row.value.value)} detections` : 'no data'}`,
      row.value?.partial ? 'month not over yet' : null,
      `median ${formatNumber(row.median)}`,
      `usual range ${formatNumber(row.p10)} to ${formatNumber(row.p90)}`,
    ]
      .filter(Boolean)
      .join(', ');

  const pickNearest = (event: PointerEvent<SVGRectElement>) => {
    const frame = event.currentTarget.getBoundingClientRect();
    cursor.pick(Math.round(((event.clientX - frame.left) / frame.width) * (rows.length - 1)));
  };

  return (
    <figure
      className={styles.chart}
      data-figure="season-profile"
      data-figure-title={`Season profile: ${year} over the typical season`}
      data-figure-year={year}
    >
      <figcaption className={styles.caption}>
        <label htmlFor={selectId}>Year over the typical season</label>
        <select
          id={selectId}
          className={styles.select}
          value={year}
          onChange={(event) => setChosen(Number(event.target.value))}
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </figcaption>

      <p className={styles.readout} data-testid="season-readout">
        <span className={styles.position}>{monthName(active.month)}</span>
        <span className={styles.key}>
          <i className={styles.lineKey} data-series="main" />
          {year} <strong>{yearValue(active)}</strong>
          {active.value?.partial && <span className={styles.aside}>month not over yet</span>}
        </span>
        <span className={styles.key}>
          <i className={styles.lineKey} data-series="median" />
          Median <strong>{formatNumber(active.median)}</strong>
        </span>
        <span className={styles.key}>
          <i className={styles.boxKey} data-series="band" />
          Usual range{' '}
          <strong>
            {formatNumber(active.p10)} to {formatNumber(active.p90)}
          </strong>
        </span>
      </p>

      {/* A slider is the closest standard role: arrow keys step through the months. */}
      <div
        ref={wrapRef}
        className={styles.plot}
        role="slider"
        tabIndex={0}
        aria-label="Month on the season profile"
        aria-valuemin={1}
        aria-valuemax={rows.length}
        aria-valuenow={active.month}
        aria-valuetext={describe(active)}
        onKeyDown={cursor.onKeyDown}
        onBlur={cursor.reset}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? styles.baseline : styles.gridline}
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className={styles.tick} x={MARGIN.left - 8} y={y(tick)} dy="0.32em">
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {rows.map((row, index) => (
            <text key={row.month} className={styles.xTick} x={x(index)} y={HEIGHT - 6}>
              {MONTH_INITIALS[row.month - 1]}
            </text>
          ))}

          <path className={styles.band} d={band} />
          {cursor.isPicked && (
            <line
              className={styles.crosshair}
              data-export-skip=""
              x1={x(cursor.active)}
              x2={x(cursor.active)}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
            />
          )}
          <path
            className={styles.medianLine}
            d={linePath(rows.map((row, index) => [x(index), y(row.median)]))}
          />
          <path className={styles.seriesLine} d={linePath(yearPoints)} />

          {/* A month that is not over is low by definition: a hollow dot says so on the plot. */}
          {rows.map(
            (row, index) =>
              row.value?.partial && (
                <circle
                  key={row.month}
                  className={styles.hollowDot}
                  cx={x(index)}
                  cy={y(row.value.value)}
                  r={4}
                />
              ),
          )}
          <circle
            className={styles.medianDot}
            data-export-skip=""
            cx={x(cursor.active)}
            cy={y(active.median)}
            r={4}
          />
          {active.value && !active.value.partial && (
            <circle
              className={styles.seriesDot}
              data-export-skip=""
              cx={x(cursor.active)}
              cy={y(active.value.value)}
              r={4.5}
            />
          )}

          <rect
            className={styles.hitArea}
            data-export-skip=""
            x={MARGIN.left}
            y={0}
            width={plotWidth}
            height={HEIGHT - MARGIN.bottom}
            onPointerMove={pickNearest}
            onPointerDown={pickNearest}
            onPointerLeave={cursor.reset}
          />
        </svg>
      </div>

      <div className={styles.srOnly}>
        <table>
          <caption>Season profile by month: {year} against the median and the usual range</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">{year}</th>
              <th scope="col">Median</th>
              <th scope="col">10th percentile</th>
              <th scope="col">90th percentile</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}>
                <th scope="row">{monthName(row.month)}</th>
                <td>{yearValue(row)}</td>
                <td>{formatNumber(row.median)}</td>
                <td>{formatNumber(row.p10)}</td>
                <td>{formatNumber(row.p90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.note}>
        The usual range holds 8 years out of 10 of the baseline, {calendar.baseline.start_year} to{' '}
        {calendar.baseline.end_year}.
      </p>
    </figure>
  );
}
