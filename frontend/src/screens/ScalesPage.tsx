import { useMemo } from 'react';
import { useCalendar, useMeta } from '../api/queries';
import type { MonthValue, SourceInfo } from '../api/types';
import { buildCells } from '../calendar/cells';
import { HeatGrid } from '../components/HeatGrid';
import { ScaleLegend } from '../components/ScaleLegend';
import { formatNumber, formatSignedPercent } from '../labels';
import { deltaE } from '../theme/color';
import { simulate, VISIONS, type Vision } from '../theme/cvd';
import {
  ANOMALY_BREAKS,
  ANOMALY_MIDPOINT,
  ANOMALY_RAMP,
  anomalyColor,
  COUNT_RAMP,
  countColor,
  quantileBreaks,
} from '../theme/scales';
import styles from './ScalesPage.module.css';

// The page shows how both calendar scales look with color-vision deficiencies.
// The same properties are checked automatically in src/theme/scales.test.ts.

/** Sample years: the extreme 2010 and the MODIS to VIIRS seam in 2012. */
const SAMPLE_YEARS = [2013, 2012, 2011, 2010, 2009, 2008];

/** The smallest difference between neighboring steps of a scale for a kind of vision. */
function closestSteps(ramp: readonly string[], vision: Vision): number {
  const seen = ramp.map((color) => simulate(color, vision));
  return Math.min(...seen.slice(1).map((color, index) => deltaE(seen[index], color)));
}

/** The smallest difference between the blue and the orange step of the same level. */
function closestBranches(vision: Vision): number {
  const seen = ANOMALY_RAMP.map((color) => simulate(color, vision));
  return Math.min(
    ...[1, 2, 3].map((step) =>
      deltaE(seen[ANOMALY_MIDPOINT - step], seen[ANOMALY_MIDPOINT + step]),
    ),
  );
}

interface ScaleCheckProps {
  ramp: readonly string[];
  months: readonly MonthValue[];
  sources: readonly SourceInfo[];
  colorOf: (month: MonthValue) => string | null;
  sampleLabel: string;
  branches?: boolean;
}

function ScaleCheck({
  ramp,
  months,
  sources,
  colorOf,
  sampleLabel,
  branches = false,
}: ScaleCheckProps) {
  return (
    <div className={styles.checks}>
      {VISIONS.map((vision) => {
        const cell = buildCells(months, sources, (month) => {
          const color = colorOf(month);
          return color === null ? null : simulate(color, vision.id);
        });
        return (
          <div key={vision.id} className={styles.check}>
            <div className={styles.vision}>
              <h3>{vision.label}</h3>
              <p>{vision.note}</p>
            </div>
            <div className={styles.ramp}>
              <div className={styles.swatches} aria-hidden="true">
                {ramp.map((color) => (
                  <span key={color} style={{ background: simulate(color, vision.id) }} />
                ))}
              </div>
              <p>
                Closest steps differ by <strong>{closestSteps(ramp, vision.id).toFixed(1)}</strong>
                {branches && (
                  <>
                    , below and above by <strong>{closestBranches(vision.id).toFixed(1)}</strong>
                  </>
                )}
              </p>
            </div>
            {months.length > 0 && (
              <div className={styles.sample}>
                <HeatGrid
                  compact
                  years={SAMPLE_YEARS}
                  cell={cell}
                  label={`${sampleLabel}, ${vision.label.toLowerCase()}`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ScalesPage() {
  const meta = useMeta();
  const preset = meta.data?.presets[0];
  const calendar = useCalendar(preset ? { geometry: preset.geometry } : null);

  const months = useMemo(() => calendar.data?.months ?? [], [calendar.data]);
  const sources = meta.data?.sources ?? [];
  const breaks = useMemo(
    () => quantileBreaks(months.filter((m) => !m.partial).map((m) => m.value)),
    [months],
  );

  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <h1>Color scales</h1>
        <p>
          The calendar uses two scales, and neither relies on telling red from green. Each row below
          shows a scale as it appears with one kind of color vision, next to six sample years of the
          calendar. Differences are distances in OKLab × 100: from 8 up, two steps are easy to tell
          apart.
        </p>
      </header>

      <section className={styles.scale} aria-labelledby="count-heading">
        <h2 id="count-heading">Detections</h2>
        <p className={styles.lead}>
          One warm hue from light to dark. Class boundaries are quantiles, because a few extreme
          months would otherwise hide the ordinary ones.
        </p>
        <ScaleLegend
          title="Fire detections per month, VIIRS-equivalent"
          colors={COUNT_RAMP}
          boundaries={breaks.map(formatNumber)}
          ends={['fewer', 'more']}
        />
        <ScaleCheck
          ramp={COUNT_RAMP}
          months={months}
          sources={sources}
          colorOf={(month) => countColor(month.value, breaks)}
          sampleLabel="Detections, 2008 to 2013"
        />
      </section>

      <section className={styles.scale} aria-labelledby="anomaly-heading">
        <h2 id="anomaly-heading">Anomaly against the median</h2>
        <p className={styles.lead}>
          Blue is below the median of the same calendar month, orange is above, gray is close to it.
          Both branches darken at the same rate, so the size of an anomaly reads from lightness and
          its direction from hue.
        </p>
        <ScaleLegend
          title="Difference from the monthly median"
          colors={ANOMALY_RAMP}
          boundaries={ANOMALY_BREAKS.map(formatSignedPercent)}
          ends={['below median', 'above median']}
        />
        <ScaleCheck
          ramp={ANOMALY_RAMP}
          months={months}
          sources={sources}
          colorOf={(month) => anomalyColor(month.anomaly_pct)}
          sampleLabel="Anomalies, 2008 to 2013"
          branches
        />
      </section>

      <section className={styles.scale} aria-labelledby="type-heading">
        <h2 id="type-heading">Typeface</h2>
        <p className={styles.lead}>
          Geologica, one family for headings, text and figures, in Latin and Cyrillic.
        </p>
        <div className={styles.specimen}>
          <p className={styles.specimenLarge}>Is it burning more than usual?</p>
          <p className={styles.specimenLarge} lang="ru">
            Сейчас горит больше обычного?
          </p>
          <p className={styles.specimenFigures}>
            1 840 detections
            <br />2 111 detections
          </p>
        </div>
      </section>
    </main>
  );
}
