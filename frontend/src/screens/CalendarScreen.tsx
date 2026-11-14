import { useState } from 'react';
import { USE_MOCKS } from '../api/config';
import { useCalendar, useMeta } from '../api/queries';
import type { CalendarResponse, Geometry, Meta } from '../api/types';
import { AreaMap } from '../components/AreaMap';
import { BurnCalendar } from '../components/BurnCalendar';
import { CoordinateForm } from '../components/CoordinateForm';
import { ErrorNote } from '../components/ErrorNote';
import { PeriodSelect, type Period } from '../components/PeriodSelect';
import { boundsOf, formatBounds } from '../geo/geometry';
import { areaKm2 } from '../geo/shapes';
import {
  formatNumber,
  formatSignedPercent,
  monthName,
  presetLabel,
  WARNING_LABELS,
} from '../labels';
import { roundSignificant } from '../theme/scales';
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
        Draw a rectangle or a polygon on the map, enter coordinates, or start with one of the
        example areas above the map. The calendar shows fire activity for every month since November
        2000.
      </p>
    </div>
  );
}

function AreaPanel({ area, meta, period }: { area: Area; meta: Meta; period: Period }) {
  const sizeKm2 = areaKm2(area.geometry);
  const limitKm2 = meta.limits.max_area_km2;
  const tooLarge = sizeKm2 > limitKm2;

  // An area above the limit is never requested: the server would refuse it anyway (F5).
  const calendar = useCalendar(
    tooLarge
      ? null
      : { geometry: area.geometry, start_year: period.startYear, end_year: period.endYear },
  );

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

      {tooLarge && (
        <p className={styles.limit} role="alert">
          This area is about {formatNumber(roundSignificant(sizeKm2, 3))} km². The limit is{' '}
          {formatNumber(limitKm2)} km². Draw or enter a smaller area.
        </p>
      )}
      {!tooLarge && calendar.isPending && <p role="status">Loading the calendar…</p>}
      {calendar.isError && <ErrorNote error={calendar.error} />}
      {calendar.data && (
        <>
          <section className={styles.section} aria-labelledby="calendar-heading">
            <h2 id="calendar-heading">Burn calendar</h2>
            <BurnCalendar calendar={calendar.data} sources={meta.sources} />
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
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);

  // The whole record is the default period (F4).
  const range: Period = {
    startYear: Number(meta.first_date.slice(0, 4)),
    endYear: Number(meta.last_date.slice(0, 4)),
  };
  const [period, setPeriod] = useState<Period>(range);

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
          <button
            type="button"
            className={styles.coordinatesToggle}
            aria-expanded={coordinatesOpen}
            aria-controls="coordinate-form"
            onClick={() => setCoordinatesOpen(!coordinatesOpen)}
          >
            Enter coordinates
          </button>
          <PeriodSelect range={range} value={period} onChange={setPeriod} />
        </div>
        {coordinatesOpen && (
          <div id="coordinate-form">
            <CoordinateForm
              geometry={area?.geometry ?? null}
              onSubmit={(geometry) => {
                setArea({ geometry, presetId: null });
                setCoordinatesOpen(false);
              }}
              onCancel={() => setCoordinatesOpen(false)}
            />
          </div>
        )}
        <div className={styles.mapSlot}>
          <AreaMap
            geometry={area?.geometry ?? null}
            // A shape drawn or edited on the map is no longer an example area.
            onChange={(geometry) => setArea(geometry ? { geometry, presetId: null } : null)}
          />
        </div>
      </section>

      <section className={styles.panel} aria-label="Fire activity">
        {area ? <AreaPanel area={area} meta={meta} period={period} /> : <StartPrompt />}

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
