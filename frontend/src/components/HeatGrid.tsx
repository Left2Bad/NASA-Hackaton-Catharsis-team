import type { CSSProperties, ReactNode } from 'react';
import { MONTH_INITIALS } from '../labels';
import styles from './HeatGrid.module.css';

/** Одна клетка сетки «год × месяц». */
export interface HeatCell {
  /** Цвет заливки; `null` — значение есть, но цвет для него не определён. */
  color: string | null;
  /** Шов слева: с этого месяца ряд ведёт другой сенсор. */
  seamLeft?: boolean;
  /** Шов снизу: год назад этот месяц вёл другой сенсор. */
  seamBottom?: boolean;
}

interface HeatGridProps {
  /** Годы сверху вниз. */
  years: readonly number[];
  /** Клетка месяца или `undefined`, если данных за месяц нет. */
  cell: (year: number, month: number) => HeatCell | undefined;
  /** Описание сетки для программ чтения с экрана. */
  label: string;
  /** Подписи справа от сетки: год, напротив которого стоит подпись, и текст. */
  sideLabels?: readonly { year: number; text: ReactNode }[];
  /** Компактный вид без шапки месяцев — для образцов на странице шкал. */
  compact?: boolean;
}

/**
 * Тепловая сетка «год × месяц»: строка — год, столбец — месяц.
 * Только рисует клетки; подсказки, итоги и медианы добавит задача B6.
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
