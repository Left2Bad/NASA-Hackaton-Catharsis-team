import type { CurrentResponse } from '../api/types';
import { CATEGORY_LABELS, formatNumber, SOURCE_LABELS, WARNING_LABELS } from '../labels';
import {
  bandRange,
  CATEGORY_COLORS,
  comparison,
  levelBands,
  levelStrip,
  periodLabel,
} from '../now/describe';
import { CumulativeChart } from './CumulativeChart';
import styles from './NowPanel.module.css';

const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

/** The strip of five levels with a mark where the current value sits. */
function LevelStrip({ current }: { current: CurrentResponse }) {
  const strip = levelStrip(current);
  const bands = levelBands(current.baseline_same_days);

  return (
    <div className={styles.levels}>
      {strip && (
        // Decorative for assistive technology: the list below says the same in words.
        <div className={styles.strip} aria-hidden="true">
          {strip.segments.map((segment) => (
            <span
              key={segment.category}
              className={styles.segment}
              style={{
                flexGrow: segment.end - segment.start,
                background: CATEGORY_COLORS[segment.category],
              }}
            />
          ))}
          <span className={styles.marker} style={{ left: percent(strip.marker) }} />
        </div>
      )}
      <ul className={styles.legend} aria-label="Levels for these days of the month">
        {bands.map((band) => (
          <li
            key={band.category}
            aria-current={band.category === current.category ? 'true' : undefined}
          >
            <span
              className={styles.swatch}
              style={{ background: CATEGORY_COLORS[band.category] }}
            />
            {CATEGORY_LABELS[band.category]}
            <span className={styles.range}>{bandRange(band)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "Now" panel (requirement F15): the current month from its start against the median
 * of the same days in the baseline years, with the level the value falls into.
 */
export function NowPanel({ current }: { current: CurrentResponse }) {
  const baseline = current.baseline_same_days;
  // The preliminary flag already has its own note, so its warning is not repeated.
  const warnings = current.warnings.filter(
    (warning) => !(current.preliminary && warning.code === 'PRELIMINARY_DATA'),
  );

  return (
    <div className={styles.now}>
      <p className={styles.period}>{periodLabel(current)}</p>

      <p className={styles.status}>
        {current.category !== null && (
          <>
            <span
              className={styles.badge}
              style={{ background: CATEGORY_COLORS[current.category] }}
            />
            <strong>{CATEGORY_LABELS[current.category]}</strong>
          </>
        )}
        <span className={styles.comparison}>{comparison(current)}</span>
      </p>

      <dl className={styles.facts}>
        <div>
          <dt>Detections so far</dt>
          <dd>{formatNumber(current.value)}</dd>
        </div>
        <div>
          <dt>Median of the same days</dt>
          <dd>{formatNumber(baseline.median)}</dd>
        </div>
        <div>
          <dt>Percentile</dt>
          <dd>{current.percentile === null ? '—' : formatNumber(current.percentile)}</dd>
        </div>
      </dl>

      <LevelStrip current={current} />

      <CumulativeChart days={current.cumulative} year={current.year} month={current.month} />

      <ul className={styles.notes}>
        <li>
          Compared with the same days of the month in {baseline.n_years} baseline years. Lead
          sensor: {SOURCE_LABELS[current.source]}.
        </li>
        {current.preliminary && <li>Preliminary: near-real-time data, to be revised.</li>}
        {warnings.map((warning) => (
          <li key={warning.code}>{WARNING_LABELS[warning.code]}</li>
        ))}
      </ul>
    </div>
  );
}
