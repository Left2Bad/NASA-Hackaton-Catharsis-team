import type { PointerEvent } from 'react';
import type { CurrentResponse } from '../api/types';
import { linePath, niceScale } from '../charts/scale';
import { useCursor } from '../charts/useCursor';
import { useElementWidth } from '../hooks/useElementWidth';
import { formatNumber, monthName, monthShortName } from '../labels';
import { dayTicks, daysInMonth } from '../now/chart';
import styles from './Chart.module.css';

type CumulativeDay = CurrentResponse['cumulative'][number];

interface CumulativeChartProps {
  days: readonly CumulativeDay[];
  year: number;
  month: number;
}

const HEIGHT = 168;
const MARGIN = { top: 10, right: 14, bottom: 24, left: 36 };
/** Width used until the chart is measured, and in tests. */
const FALLBACK_WIDTH = 480;

/**
 * Detections accumulated since the start of the month, against the median of the same
 * days in the baseline years. The time axis covers the whole month, so the empty part
 * on the right shows how much of the month is still ahead.
 *
 * The readout above the plot shows the numbers of one day: the latest by default,
 * the one under the pointer on hover, and the one chosen with the arrow keys on focus.
 * A visually hidden table carries the same numbers for screen readers.
 */
export function CumulativeChart({ days, year, month }: CumulativeChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  // With no day picked by the pointer or the keyboard, the chart reads out the latest day.
  const cursor = useCursor(days.length, days.length - 1);

  if (days.length === 0) return null;

  const monthLength = daysInMonth(year, month);
  const scale = niceScale(Math.max(...days.map((day) => Math.max(day.value, day.median))));
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (day: number) => MARGIN.left + ((day - 1) / (monthLength - 1)) * plotWidth;
  const y = (value: number) => MARGIN.top + (1 - value / scale.max) * plotHeight;

  const lastIndex = days.length - 1;
  const active = days[cursor.active];
  const describe = (day: CumulativeDay) =>
    `${monthName(month)} ${day.day}: ${formatNumber(day.value)} so far, median ${formatNumber(day.median)}`;

  const pickNearest = (event: PointerEvent<SVGRectElement>) => {
    const frame = event.currentTarget.getBoundingClientRect();
    const day = 1 + ((event.clientX - frame.left) / frame.width) * (monthLength - 1);
    let nearest = 0;
    days.forEach((item, index) => {
      if (Math.abs(item.day - day) < Math.abs(days[nearest].day - day)) nearest = index;
    });
    cursor.pick(nearest);
  };

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.caption}>
        Detections accumulated since the start of the month
      </figcaption>

      <p className={styles.readout} data-testid="cumulative-readout">
        <span className={styles.position}>
          {monthName(month)} {active.day}
        </span>
        <span className={styles.key}>
          <i className={styles.lineKey} data-series="main" />
          This month <strong>{formatNumber(active.value)}</strong>
        </span>
        <span className={styles.key}>
          <i className={styles.lineKey} data-series="median" />
          Median of the same days <strong>{formatNumber(active.median)}</strong>
        </span>
      </p>

      {/* A slider is the closest standard role: arrow keys step through the days. */}
      <div
        ref={wrapRef}
        className={styles.plot}
        role="slider"
        tabIndex={0}
        aria-label="Day of the month on the chart"
        aria-valuemin={days[0].day}
        aria-valuemax={days[lastIndex].day}
        aria-valuenow={active.day}
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
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {dayTicks(monthLength).map((day) => (
            <text key={day} className={styles.xTick} x={x(day)} y={HEIGHT - 6}>
              {day === 1 ? `${monthShortName(month)} 1` : day}
            </text>
          ))}

          {cursor.isPicked && (
            <line
              className={styles.crosshair}
              x1={x(active.day)}
              x2={x(active.day)}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
            />
          )}

          <path
            className={styles.medianLine}
            d={linePath(days.map((day) => [x(day.day), y(day.median)]))}
          />
          <path
            className={styles.seriesLine}
            d={linePath(days.map((day) => [x(day.day), y(day.value)]))}
          />
          {/* The dots sit on the active day; the surface-colored ring keeps them legible on the lines. */}
          <circle className={styles.medianDot} cx={x(active.day)} cy={y(active.median)} r={4} />
          <circle className={styles.seriesDot} cx={x(active.day)} cy={y(active.value)} r={4.5} />

          <rect
            className={styles.hitArea}
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

      <table className={styles.srOnly}>
        <caption>Detections accumulated since the start of the month, by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">This month</th>
            <th scope="col">Median of the same days</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">
                {monthName(month)} {day.day}
              </th>
              <td>{formatNumber(day.value)}</td>
              <td>{formatNumber(day.median)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
