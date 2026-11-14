import type { PointerEvent, ReactNode } from 'react';
import { linePath, niceScale, tickFormat } from '../charts/scale';
import { useCursor } from '../charts/useCursor';
import { useElementWidth } from '../hooks/useElementWidth';
import { formatNumber } from '../labels';
import styles from './Chart.module.css';

/** One line of the chart. `null` in `values` is a gap: the line breaks there. */
export interface LineSeries {
  id: string;
  label: string;
  /** A color of the chart stylesheet: `--series-main`, `--series-blue`, `--series-purple`. */
  color: string;
  /** A dashed line: a second cue besides color. */
  dashed?: boolean;
  values: readonly (number | null)[];
}

interface LineChartProps {
  caption: ReactNode;
  /** What each position along the horizontal axis is called in the readout: "2012", "August 2021". */
  positions: readonly string[];
  /** Positions that get a label under the axis. */
  ticks: readonly { index: number; label: string }[];
  series: readonly LineSeries[];
  /** Header of the first column of the table, and the name of the keyboard control. */
  positionName: string;
  /** Position the readout shows before the reader picks one. Defaults to the last. */
  defaultIndex?: number;
  note?: ReactNode;
}

const HEIGHT = 200;
const MARGIN = { top: 10, right: 14, bottom: 24, left: 44 };
const FALLBACK_WIDTH = 480;

/** Splits a series at its gaps into runs of consecutive points. */
function runs(
  values: readonly (number | null)[],
  point: (index: number, value: number) => readonly [number, number],
): (readonly [number, number])[][] {
  const result: (readonly [number, number])[][] = [];
  let run: (readonly [number, number])[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) result.push(run);
      run = [];
    } else {
      run.push(point(index, value));
    }
  });
  if (run.length > 0) result.push(run);
  return result;
}

/**
 * A line chart of several series over the same positions, used on the "Method" page.
 * Like the other charts: a readout above the plot that follows the pointer or the arrow
 * keys, a hidden table with the same numbers, and identity that never rests on color alone
 * (every line is named in the readout, and reference lines are dashed).
 */
export function LineChart({
  caption,
  positions,
  ticks,
  series,
  positionName,
  defaultIndex,
  note,
}: LineChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const cursor = useCursor(positions.length, defaultIndex ?? positions.length - 1);

  if (positions.length === 0) return null;

  const all = series.flatMap((line) => line.values.filter((value) => value !== null));
  const scale = niceScale(Math.max(0, ...all));
  const formatTick = tickFormat(scale.max);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) =>
    MARGIN.left + (positions.length === 1 ? 0.5 : index / (positions.length - 1)) * plotWidth;
  const y = (value: number) => MARGIN.top + (1 - value / scale.max) * plotHeight;
  const show = (value: number | null | undefined) =>
    value === null || value === undefined ? 'no data' : formatNumber(value);

  const describe = (index: number) =>
    `${positions[index]}: ${series.map((line) => `${line.label} ${show(line.values[index])}`).join(', ')}`;

  const pickNearest = (event: PointerEvent<SVGRectElement>) => {
    const frame = event.currentTarget.getBoundingClientRect();
    cursor.pick(Math.round(((event.clientX - frame.left) / frame.width) * (positions.length - 1)));
  };

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.caption}>{caption}</figcaption>

      <p className={styles.readout}>
        <span className={styles.position}>{positions[cursor.active]}</span>
        {series.map((line) => (
          <span key={line.id} className={styles.key}>
            <i
              className={styles.lineKey}
              style={{
                borderTopColor: `var(${line.color})`,
                borderTopStyle: line.dashed ? 'dashed' : 'solid',
              }}
            />
            {line.label} <strong>{show(line.values[cursor.active])}</strong>
          </span>
        ))}
      </p>

      <div
        ref={wrapRef}
        className={styles.plot}
        role="slider"
        tabIndex={0}
        aria-label={`${positionName} on the chart`}
        aria-valuemin={1}
        aria-valuemax={positions.length}
        aria-valuenow={cursor.active + 1}
        aria-valuetext={describe(cursor.active)}
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
          {ticks.map((tick) => (
            <text key={tick.index} className={styles.xTick} x={x(tick.index)} y={HEIGHT - 6}>
              {tick.label}
            </text>
          ))}

          {cursor.isPicked && (
            <line
              className={styles.crosshair}
              x1={x(cursor.active)}
              x2={x(cursor.active)}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
            />
          )}

          {series.map((line) =>
            runs(line.values, (index, value) => [x(index), y(value)] as const).map((run, part) => (
              <path
                key={`${line.id}-${part}`}
                className={styles.seriesLine}
                d={linePath(run)}
                style={{
                  stroke: `var(${line.color})`,
                  strokeDasharray: line.dashed ? '5 4' : undefined,
                }}
              />
            )),
          )}
          {series.map((line) => {
            const value = line.values[cursor.active];
            return value === null || value === undefined ? null : (
              <circle
                key={line.id}
                className={styles.pointDot}
                cx={x(cursor.active)}
                cy={y(value)}
                r={4}
                style={{ fill: `var(${line.color})` }}
              />
            );
          })}

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
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{positionName}</th>
            {series.map((line) => (
              <th key={line.id} scope="col">
                {line.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((position, index) => (
            <tr key={position}>
              <th scope="row">{position}</th>
              {series.map((line) => (
                <td key={line.id}>{show(line.values[index])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {note && <p className={styles.note}>{note}</p>}
    </figure>
  );
}
