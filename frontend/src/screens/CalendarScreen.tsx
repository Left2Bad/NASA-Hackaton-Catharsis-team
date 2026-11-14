import { useState } from 'react';
import { USE_MOCKS } from '../api/config';
import { useCalendar, useMeta } from '../api/queries';
import type { CalendarResponse, Geometry, Meta } from '../api/types';
import { AreaMap } from '../components/AreaMap';
import { CalendarPreview } from '../components/CalendarPreview';
import { ErrorNote } from '../components/ErrorNote';
import { boundsOf, formatBounds } from '../geo/geometry';
import {
  formatNumber,
  formatSignedPercent,
  monthName,
  presetLabel,
  WARNING_LABELS,
} from '../labels';
import styles from './CalendarScreen.module.css';

// The main screen: the map with area selection on the left, the panel with the
// calendar and analytics on the right. Some panel sections are still only listed.

/** The area of interest: its shape and, when it came from an example, which one. */
interface Area {
  geometry: Geometry;
  presetId: string | null;
}

const PLANNED = [
  'Now: the current month so far against the same days of past years',
  'Season profile: the monthly median with its 10th to 90th percentile band',
  'Yearly totals with a trend line',
  'Downloads: hot spots as CSV, the calendar as CSV, charts as PNG',
];

function Summary({ calendar }: { calendar: CalendarResponse }) {
  const { summary } = calendar;
  return (
    <dl className={styles.facts}>
      <div>
        <dt>Most active year</dt>
        <dd>{summary.peak_year ?? '—'}</dd>
      </div>
      <div>
        <dt>Peak month</dt>
        <dd>{summary.peak_month === null ? '—' : monthName(summary.peak_month)}</dd>
      </div>
      <div>
        <dt>Detections in period</dt>
        <dd>{formatNumber(Math.round(summary.total))}</dd>
      </div>
      <div>
        <dt>Trend per decade</dt>
        <dd>
          {summary.trend_pct_per_decade === null
            ? '—'
            : formatSignedPercent(summary.trend_pct_per_decade)}
        </dd>
      </div>
    </dl>
  );
}

/** Shown before any area is chosen: tells the user how to start. */
function StartPrompt() {
  return (
    <div className={styles.start}>
      <h1>Choose an area to see its fire calendar</h1>
      <p>
        Draw a rectangle or a polygon on the map, or start with one of the example areas above the
        map. The calendar shows fire activity for every month since November 2000.
      </p>
    </div>
  );
}

function AreaPanel({ area, meta }: { area: Area; meta: Meta }) {
  const calendar = useCalendar({ geometry: area.geometry });

  const preset = meta.presets.find((item) => item.id === area.presetId);
  const label = preset ? presetLabel(preset) : { name: 'Custom area', description: '' };

  return (
    <>
      <header className={styles.areaHeader}>
        <h1>{label.name}</h1>
        <p className={styles.description}>
          {label.description || formatBounds(boundsOf(area.geometry))}
        </p>
        {calendar.data && (
          <p className={styles.meta}>
            {formatNumber(calendar.data.area_km2)} km², data through {calendar.data.data_through}
          </p>
        )}
      </header>

      {calendar.isPending && <p role="status">Loading the calendar…</p>}
      {calendar.isError && <ErrorNote error={calendar.error} />}
      {calendar.data && (
        <>
          <section className={styles.section} aria-labelledby="calendar-heading">
            <h2 id="calendar-heading">Burn calendar</h2>
            <CalendarPreview calendar={calendar.data} sources={meta.sources} />
            {calendar.data.warnings.length > 0 && (
              <ul className={styles.warnings}>
                {calendar.data.warnings.map((warning) => (
                  <li key={warning.code}>{WARNING_LABELS[warning.code]}</li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="summary-heading">
            <h2 id="summary-heading">Summary</h2>
            <Summary calendar={calendar.data} />
          </section>
        </>
      )}

      <section className={styles.section} aria-labelledby="planned-heading">
        <h2 id="planned-heading">Coming to this panel</h2>
        <ul className={styles.planned}>
          {PLANNED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Workspace({ meta }: { meta: Meta }) {
  const [area, setArea] = useState<Area | null>(null);

  const firstYear = meta.first_date.slice(0, 4);
  const lastYear = meta.last_date.slice(0, 4);

  return (
    <main className={styles.screen}>
      <section className={styles.mapColumn} aria-label="Area selection">
        <div className={styles.areaBar}>
          <div className={styles.presets} role="group" aria-label="Example areas">
            {meta.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={preset.id === area?.presetId}
                onClick={() => setArea({ geometry: preset.geometry, presetId: preset.id })}
              >
                {presetLabel(preset).name}
              </button>
            ))}
          </div>
          <p className={styles.period}>
            Period{' '}
            <strong>
              {firstYear} to {lastYear}
            </strong>
          </p>
        </div>
        <AreaMap
          geometry={area?.geometry ?? null}
          // A shape drawn or edited on the map is no longer an example area.
          onChange={(geometry) => setArea(geometry ? { geometry, presetId: null } : null)}
        />
      </section>

      <section className={styles.panel} aria-label="Fire activity">
        {area ? <AreaPanel area={area} meta={meta} /> : <StartPrompt />}

        <footer className={styles.footer}>
          <p>
            We acknowledge the use of data from NASA&apos;s Fire Information for Resource Management
            System (FIRMS), part of NASA&apos;s Earth Science Data and Information System (ESDIS).
          </p>
          <p>
            Data version {meta.data_version}.
            {USE_MOCKS && ' Mock mode: synthetic numbers, the same for every area.'}
          </p>
        </footer>
      </section>
    </main>
  );
}

export function CalendarScreen() {
  const meta = useMeta();

  if (meta.isPending) {
    return (
      <main className={styles.state}>
        <p role="status">Loading the dataset…</p>
      </main>
    );
  }
  if (meta.isError) {
    return (
      <main className={styles.state}>
        <ErrorNote error={meta.error} />
      </main>
    );
  }
  return <Workspace meta={meta.data} />;
}
