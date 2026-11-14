import type { CalendarResponse } from '../api/types';
import { summaryFacts, type TrendDirection } from '../calendar/summary';
import styles from './SummaryFacts.module.css';

/** How far the arrow is turned from pointing right: up-right, down-right, or level. */
const ARROW_ROTATION: Record<TrendDirection, number> = { up: -45, down: 45, flat: 0 };

/** An arrow that repeats the trend word, so the direction is read at a glance. */
function TrendArrow({ direction }: { direction: TrendDirection }) {
  return (
    <svg
      className={styles.arrow}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ transform: `rotate(${ARROW_ROTATION[direction]}deg)` }}
    >
      <path d="M2 8h11M9 4l4 4-4 4" />
    </svg>
  );
}

/**
 * The summary of four numbers (requirement F16): the most active year, the peak month,
 * the detections of the period and the direction of the trend of yearly totals.
 */
export function SummaryFacts({ calendar }: { calendar: CalendarResponse }) {
  const facts = summaryFacts(calendar);
  // An area without fires still answers with 200: the facts are empty, so say why.
  const noFires = calendar.summary.total === 0;

  return (
    <>
      <dl className={styles.facts}>
        {facts.map((fact) => (
          <div key={fact.id} data-fact={fact.id}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.trend && <TrendArrow direction={fact.trend} />}
              {fact.value}
            </dd>
            {fact.detail && <dd className={styles.detail}>{fact.detail}</dd>}
          </div>
        ))}
      </dl>
      {noFires && (
        <p className={styles.empty}>No fires were detected in this area in the chosen period.</p>
      )}
    </>
  );
}
