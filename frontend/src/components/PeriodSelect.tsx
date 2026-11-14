import { useId } from 'react';
import styles from './PeriodSelect.module.css';

/** The years the calendar covers, both ends included. */
export interface Period {
  startYear: number;
  endYear: number;
}

interface PeriodSelectProps {
  /** The first and the last year available in the dataset. */
  range: Period;
  value: Period;
  onChange: (period: Period) => void;
}

/**
 * Chooses the period by years (requirement F4). The whole record is the default.
 * Each list only offers years that keep the period valid, so "from" can never pass "to".
 */
export function PeriodSelect({ range, value, onChange }: PeriodSelectProps) {
  const id = useId();
  const years = Array.from(
    { length: range.endYear - range.startYear + 1 },
    (_, index) => range.startYear + index,
  );

  return (
    <div className={styles.period} role="group" aria-label="Period">
      <label htmlFor={`${id}-from`}>From</label>
      <select
        id={`${id}-from`}
        value={value.startYear}
        onChange={(event) => onChange({ ...value, startYear: Number(event.target.value) })}
      >
        {years
          .filter((year) => year <= value.endYear)
          .map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
      </select>
      <label htmlFor={`${id}-to`}>to</label>
      <select
        id={`${id}-to`}
        value={value.endYear}
        onChange={(event) => onChange({ ...value, endYear: Number(event.target.value) })}
      >
        {years
          .filter((year) => year >= value.startYear)
          .map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
      </select>
    </div>
  );
}
