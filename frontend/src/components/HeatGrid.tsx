import type { CSSProperties, ReactNode } from 'react';
import { MONTH_INITIALS } from '../labels';
import styles from './HeatGrid.module.css';

/** One cell of the year-by-month grid. */
export interface HeatCell {
  /** Fill color; `null` means there is a value but no color is defined for it. */
  color: string | null;
  /** Seam on the left: another sensor leads the record from this month on. */
  seamLeft?: boolean;
  /** Seam below: another sensor led this month a year earlier. */
  seamBottom?: boolean;
}

interface HeatGridProps {
  /** Years from top to bottom. */
  years: readonly number[];
  /** The cell for a month, or `undefined` when the month has no data. */
  cell: (year: number, month: number) => HeatCell | undefined;
  /** Description of the grid for screen readers. */
  label: string;
  /** Labels to the right of the grid: the year each label sits next to, and its text. */
  sideLabels?: readonly { year: number; text: ReactNode }[];
  /** Compact form without the month header, for samples on the color scales page. */
  compact?: boolean;
}

/**
 * Year-by-month heat grid: a row per year, a column per month.
 * It only draws the cells; tooltips, totals and medians come with task B6.
 */
export function HeatGrid({ years, cell, label, sideLabels = [], compact = false }: HeatGridProps) {
  const firstRow = compact ? 1 : 2;
  const rowOf = (year: number) => firstRow + years.indexOf(year);

  return (
    <div
      className={compact ? `${styles.grid} ${styles.compact}` : styles.grid}
      role="img"
      aria-label={label}
    >
      {!compact &&
        MONTH_INITIALS.map((initial, index) => (
          <span
            key={index}
            className={styles.month}
            style={{ gridColumn: index + 2, gridRow: 1 }}
            aria-hidden="true"
          >
            {initial}
          </span>
        ))}

      {years.map((year) => (
        <span
          key={year}
          className={styles.year}
          style={{ gridColumn: 1, gridRow: rowOf(year) }}
          aria-hidden="true"
        >
          {year}
        </span>
      ))}

      {years.flatMap((year) =>
        Array.from({ length: 12 }, (_, index) => {
          const month = index + 1;
          const data = cell(year, month);
          const position: CSSProperties = { gridColumn: month + 1, gridRow: rowOf(year) };
          if (!data) {
            return <span key={`${year}-${month}`} className={styles.empty} style={position} />;
          }
          const seam = [data.seamLeft && 'left', data.seamBottom && 'bottom']
            .filter(Boolean)
            .join(' ');
          return (
            <span
              key={`${year}-${month}`}
              className={styles.cell}
              style={{ ...position, background: data.color ?? undefined }}
              data-month={`${year}-${String(month).padStart(2, '0')}`}
              data-seam={seam || undefined}
            />
          );
        }),
      )}

      {sideLabels.map((side) => (
        <span
          key={side.year}
          className={styles.side}
          style={{ gridColumn: 14, gridRow: rowOf(side.year) }}
          aria-hidden="true"
        >
          {side.text}
        </span>
      ))}
    </div>
  );
}
