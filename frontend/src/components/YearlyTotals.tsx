import { useId, type PointerEvent } from 'react';
import type { CalendarResponse } from '../api/types';
import { trendAt, yearTicks } from '../calendar/series';
import { niceScale, tickFormat } from '../charts/scale';
import { useCursor } from '../charts/useCursor';
import { useElementWidth } from '../hooks/useElementWidth';
import { formatNumber, formatSignedPercent } from '../labels';
import styles from './Chart.module.css';

type YearTotal = CalendarResponse['yearly'][number];

const HEIGHT = 200;
const MARGIN = { top: 10, right: 14, bottom: 24, left: 44 };
/** Width used until the chart is measured, and in tests. */
const FALLBACK_WIDTH = 480;
/** Bars never grow wider than this; the rest of a year's slot stays empty. */
const MAX_BAR = 24;
/** Room one year label needs under the axis, in pixels. */
const LABEL_ROOM = 44;

/** A bar with a rounded top that stands square on the baseline. */
function barPath(left: number, top: number, width: number, bottom: number): string {
  const radius = Math.min(4, width / 2, Math.max(0, bottom - top));
  return [
    `M${left.toFixed(1)} ${bottom.toFixed(1)}`,
    `V${(top + radius).toFixed(1)}`,
    `Q${left.toFixed(1)} ${top.toFixed(1)} ${(left + radius).toFixed(1)} ${top.toFixed(1)}`,
    `H${(left + width - radius).toFixed(1)}`,
    `Q${(left + width).toFixed(1)} ${top.toFixed(1)} ${(left + width).toFixed(1)} ${(top + radius).toFixed(1)}`,
    `V${bottom.toFixed(1)}`,
    'Z',
  ].join(' ');
}

/**
 * Yearly totals as bars with the trend line over them (requirement F18).
 * Incomplete years, the first and the current one, are hatched: their totals are low
 * because the year is not whole, and they take no part in the trend.
 *
 * The readout above the plot shows one year: the latest complete year by default,
 * the one under the pointer on hover, the one chosen with the arrow keys on focus.
 */
export function YearlyTotals({ calendar }: { calendar: CalendarResponse }) {
  // The id goes into a CSS `url(#…)`, so characters that need escaping there are dropped.
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const { yearly, summary } = calendar;
  const trend = summary.trend_line ?? null;

  const lastComplete = yearly.map((year) => year.complete).lastIndexOf(true);
  const cursor = useCursor(yearly.length, lastComplete >= 0 ? lastComplete : yearly.length - 1);

  if (yearly.length === 0) return null;

  const scale = niceScale(
    Math.max(...yearly.map((year) => year.total), trend?.start_value ?? 0, trend?.end_value ?? 0),
  );
  const formatTick = tickFormat(scale.max);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = plotWidth / yearly.length;
  // A 2px gap in the surface color separates neighboring bars.
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot - 2));
  const center = (index: number) => MARGIN.left + slot * (index + 0.5);
  const y = (value: number) => MARGIN.top + (1 - value / scale.max) * plotHeight;
  const indexOfYear = (year: number) => yearly.findIndex((item) => item.year === year);

  const active = yearly[cursor.active];
  const activeTrend = trend ? trendAt(trend, active.year) : null;
  const ticks = yearTicks(
    yearly.map((year) => year.year),
    Math.max(2, Math.floor(plotWidth / LABEL_ROOM)),
  );
  const trendText =
    summary.trend_pct_per_decade === null
      ? null
      : `${formatSignedPercent(summary.trend_pct_per_decade)} per decade`;

  const describe = (year: YearTotal) =>
    [
      `${year.year}: ${formatNumber(year.total)} detections`,
      year.complete ? null : 'incomplete year',
      trend && trendAt(trend, year.year) !== null
        ? `trend ${formatNumber(Math.round(trendAt(trend, year.year) as number))}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');

  const pickNearest = (event: PointerEvent<SVGRectElement>) => {
    const frame = event.currentTarget.getBoundingClientRect();
    cursor.pick(Math.floor(((event.clientX - frame.left) / frame.width) * yearly.length));
  };

  return (
    <figure
      className={styles.chart}
      data-figure="yearly-totals"
      data-figure-title="Fire detections per year"
    >
      <figcaption className={styles.caption}>Detections per year</figcaption>

      <p className={styles.readout} data-testid="yearly-readout">
        <span className={styles.position}>{active.year}</span>
        <span className={styles.key}>
          <i className={styles.boxKey} data-series={active.complete ? 'main' : 'hatched'} />
          Total <strong>{formatNumber(active.total)}</strong>
          {!active.complete && <span className={styles.aside}>incomplete year</span>}
        </span>
        {trend && (
          <span className={styles.key}>
            <i className={styles.lineKey} data-series="trend" />
            Trend{' '}
            <strong>{activeTrend === null ? '—' : formatNumber(Math.round(activeTrend))}</strong>
          </span>
        )}
      </p>

      {/* A slider is the closest standard role: arrow keys step through the years. */}
      <div
        ref={wrapRef}
        className={styles.plot}
        role="slider"
        tabIndex={0}
        aria-label="Year on the chart of yearly totals"
        aria-valuemin={yearly[0].year}
        aria-valuemax={yearly[yearly.length - 1].year}
        aria-valuenow={active.year}
        aria-valuetext={describe(active)}
        onKeyDown={cursor.onKeyDown}
        onBlur={cursor.reset}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
          <defs>
            {/* The hatch marks an incomplete year without relying on a lighter color alone. */}
            <pattern
              id={hatchId}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect className={styles.hatchGround} width="5" height="5" />
              <line className={styles.hatchInk} x1="0" y1="0" x2="0" y2="5" />
            </pattern>
          </defs>

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
          {ticks.map((year) => (
            <text key={year} className={styles.xTick} x={center(indexOfYear(year))} y={HEIGHT - 6}>
              {year}
            </text>
          ))}

          {yearly.map((year, index) => (
            <path
              key={year.year}
              className={styles.bar}
              data-year={year.year}
              data-active={index === cursor.active && cursor.isPicked ? '' : undefined}
              d={barPath(center(index) - barWidth / 2, y(year.total), barWidth, y(0))}
              // An inline style, because the stylesheet's fill would win over a `fill` attribute.
              style={year.complete ? undefined : { fill: `url(#${hatchId})` }}
            />
          ))}

          {trend && (
            <line
              className={styles.trendLine}
              x1={center(indexOfYear(trend.start_year))}
              y1={y(trend.start_value)}
              x2={center(indexOfYear(trend.end_year))}
              y2={y(trend.end_value)}
            />
          )}
          {activeTrend !== null && cursor.isPicked && (
            <circle
              className={styles.trendDot}
              data-export-skip=""
              cx={center(cursor.active)}
              cy={y(activeTrend)}
              r={4}
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

      <table className={styles.srOnly}>
        <caption>Detections per year{trend ? ' and the trend line' : ''}</caption>
        <thead>
          <tr>
            <th scope="col">Year</th>
            <th scope="col">Total</th>
            <th scope="col">Whole year</th>
            {trend && <th scope="col">Trend</th>}
          </tr>
        </thead>
        <tbody>
          {yearly.map((year) => {
            const value = trend ? trendAt(trend, year.year) : null;
            return (
              <tr key={year.year}>
                <th scope="row">{year.year}</th>
                <td>{formatNumber(year.total)}</td>
                <td>{year.complete ? 'yes' : 'no'}</td>
                {trend && <td>{value === null ? '—' : formatNumber(Math.round(value))}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className={styles.note}>
        {trend
          ? `The trend is a straight-line fit over the complete years, ${trend.start_year} to ${trend.end_year}${trendText ? `: ${trendText}` : ''}. Hatched years are incomplete and are left out of it.`
          : 'There are too few complete years in this period to fit a trend.'}
      </p>
    </figure>
  );
}
