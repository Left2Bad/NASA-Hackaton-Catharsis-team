import { useEffect, useState } from 'react';
import { USE_MOCKS } from '../api/config';
import { useCalendar, useCurrent, useMeta } from '../api/queries';
import type { Geometry, Meta } from '../api/types';
import { AreaMap } from '../components/AreaMap';
import { BurnCalendar, type CalendarMode } from '../components/BurnCalendar';
import { CoordinateForm } from '../components/CoordinateForm';
import { Downloads } from '../components/Downloads';
import { ErrorNote } from '../components/ErrorNote';
import { LoadingNote } from '../components/LoadingNote';
import { NowPanel } from '../components/NowPanel';
import { PeriodSelect, type Period } from '../components/PeriodSelect';
import { SeasonProfile } from '../components/SeasonProfile';
import { SummaryFacts } from '../components/SummaryFacts';
import { YearlyTotals } from '../components/YearlyTotals';
import { boundsOf, formatBounds } from '../geo/geometry';
import { areaKm2 } from '../geo/shapes';
import { formatNumber, monthName, presetLabel, WARNING_LABELS } from '../labels';
import { buildSearch, currentSearch, parseSearch, writeSearch } from '../state/link';
import { roundSignificant } from '../theme/scales';
import styles from './CalendarScreen.module.css';

// The main screen: the map with area selection on the left, the panel with the
// calendar, the analytics and the downloads on the right.

/** The area of interest: its shape and, when it came from an example, which one. */
interface Area {
  geometry: Geometry;
  presetId: string | null;
}

/** Shown before any area is chosen: tells the user how to start. */
function StartPrompt({ meta }: { meta: Meta }) {
  // The first month of the record comes from the dataset, not from the text.
  const [firstYear, firstMonth] = meta.first_date.split('-').map(Number);
  return (
    <div className={styles.start}>
      <h1>Choose an area to see its fire calendar</h1>
      <p>
        Draw a rectangle or a polygon on the map, enter coordinates, or start with one of the
        example areas above the map. The calendar shows fire activity for every month since{' '}
        {monthName(firstMonth)} {firstYear}.
      </p>
      {!meta.coverage.global && meta.coverage.regions.length > 0 && (
        <p>Data is loaded for these regions only: {meta.coverage.regions.join(', ')}.</p>
      )}
    </div>
  );
}

/** Shown instead of the calendar when the area had no fires at all in the period. */
function EmptyResult({ period }: { period: Period }) {
  const years =
    period.startYear === period.endYear
      ? `in ${period.startYear}`
      : `from ${period.startYear} to ${period.endYear}`;
  return (
    <section className={styles.empty} aria-labelledby="empty-heading">
      <h2 id="empty-heading">No fires detected</h2>
      <p>
        The satellites recorded no fire detections in this area {years}. Try a larger area, a longer
        period, or one of the example areas above the map.
      </p>
    </section>
  );
}

/**
 * Copies the address of the page, which holds the area, the period and the mode (F26).
 * Where the browser does not let a page write to the clipboard, the button says how
 * to copy the address by hand.
 */
function CopyLink() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <p className={styles.share}>
      <button type="button" onClick={() => void copy()}>
        Copy link to this view
      </button>
      <span role="status">
        {status === 'copied' && 'Link copied.'}
        {status === 'failed' && 'Copy the address from the address bar of the browser.'}
      </span>
    </p>
  );
}

interface AreaPanelProps {
  area: Area;
  meta: Meta;
  period: Period;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
}

function AreaPanel({ area, meta, period, mode, onModeChange }: AreaPanelProps) {
  const sizeKm2 = areaKm2(area.geometry);
  const limitKm2 = meta.limits.max_area_km2;
  const tooLarge = sizeKm2 > limitKm2;

  // An area above the limit is never requested: the server would refuse it anyway (F5).
  const calendar = useCalendar(
    tooLarge
      ? null
      : { geometry: area.geometry, start_year: period.startYear, end_year: period.endYear },
  );

  // "Now" does not depend on the chosen period, so it is asked for the geometry alone
  // and is not asked again when the period changes.
  const current = useCurrent(tooLarge ? null : area.geometry);

  const data = calendar.data;
  // Only the period changed: the previous calendar stays on screen, dimmed, until the new one arrives.
  const updating = calendar.isPlaceholderData;
  // An area without fires is a valid answer (200 with zeros), not an error.
  const empty = data !== undefined && data.summary.total === 0;

  const preset = meta.presets.find((item) => item.id === area.presetId);
  const label = preset ? presetLabel(preset) : { name: 'Custom area', description: '' };

  return (
    <>
      <header className={styles.areaHeader}>
        <h1>{label.name}</h1>
        <p className={styles.description}>
          {label.description || formatBounds(boundsOf(area.geometry))}
        </p>
        {data && (
          <p className={styles.meta}>
            {formatNumber(data.area_km2)} km², data through {data.data_through}
            {updating && <span role="status"> · updating for the new period…</span>}
          </p>
        )}
        <CopyLink />
      </header>

      {tooLarge && (
        <p className={styles.limit} role="alert">
          This area is about {formatNumber(roundSignificant(sizeKm2, 3))} km². The limit is{' '}
          {formatNumber(limitKm2)} km². Draw or enter a smaller area.
        </p>
      )}
      {!tooLarge && calendar.isPending && (
        <div className={styles.status}>
          <LoadingNote slowHint="Still working: a large area or a long period takes longer.">
            Loading the calendar…
          </LoadingNote>
        </div>
      )}
      {calendar.isError && (
        <div className={styles.status}>
          <ErrorNote
            error={calendar.error}
            onRetry={() => void calendar.refetch()}
            retrying={calendar.isFetching}
          />
        </div>
      )}
      {data && empty && <EmptyResult period={period} />}
      {data && !empty && (
        <div className={styles.results} aria-busy={updating}>
          <section className={styles.section} aria-labelledby="calendar-heading">
            <h2 id="calendar-heading">Burn calendar</h2>
            <BurnCalendar
              calendar={data}
              sources={meta.sources}
              mode={mode}
              onModeChange={onModeChange}
            />
            {data.warnings.length > 0 && (
              <ul className={styles.warnings}>
                {data.warnings.map((warning) => (
                  <li key={warning.code}>{WARNING_LABELS[warning.code]}</li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="summary-heading">
            <h2 id="summary-heading">Summary</h2>
            <SummaryFacts calendar={data} />
          </section>
        </div>
      )}

      {!tooLarge && (
        <section className={styles.section} aria-labelledby="now-heading">
          <h2 id="now-heading">Now</h2>
          {current.isPending && <LoadingNote>Loading the current month…</LoadingNote>}
          {current.isError && (
            <ErrorNote
              error={current.error}
              onRetry={() => void current.refetch()}
              retrying={current.isFetching}
            />
          )}
          {current.data && <NowPanel current={current.data} />}
        </section>
      )}

      {data && !empty && (
        <div className={styles.results} aria-busy={updating}>
          <section className={styles.section} aria-labelledby="season-heading">
            <h2 id="season-heading">Season profile</h2>
            <SeasonProfile calendar={data} />
          </section>

          <section className={styles.section} aria-labelledby="yearly-heading">
            <h2 id="yearly-heading">Yearly totals</h2>
            <YearlyTotals calendar={data} />
          </section>
        </div>
      )}

      {data && !empty && (
        <section className={styles.section} aria-labelledby="downloads-heading">
          <h2 id="downloads-heading">Downloads</h2>
          <Downloads
            scope={{
              geometry: area.geometry,
              presetId: area.presetId,
              startYear: period.startYear,
              endYear: period.endYear,
            }}
            areaName={label.name}
            calendar={data}
            meta={meta}
            mode={mode}
            current={current.data}
          />
        </section>
      )}
    </>
  );
}

function Workspace({ meta }: { meta: Meta }) {
  // The whole record is the default period (F4).
  const range: Period = {
    startYear: Number(meta.first_date.slice(0, 4)),
    endYear: Number(meta.last_date.slice(0, 4)),
  };
  // The screen starts from what the address asks for (F26): a shared link reopens the
  // same area, period and mode. Without a state in the address these are the defaults.
  const [linked] = useState(() => parseSearch(currentSearch(), meta, range));
  const [area, setArea] = useState<Area | null>(linked.area);
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const [period, setPeriod] = useState<Period>({
    startYear: linked.startYear,
    endYear: linked.endYear,
  });
  // The calendar mode is kept here, so it survives a change of area or period.
  const [mode, setMode] = useState<CalendarMode>(linked.mode);

  // Every change goes back into the address, so the address always describes the screen.
  const search = buildSearch(
    { area, startYear: period.startYear, endYear: period.endYear, mode },
    range,
  );
  useEffect(() => {
    writeSearch(search);
  }, [search]);

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
        {area ? (
          <AreaPanel area={area} meta={meta} period={period} mode={mode} onModeChange={setMode} />
        ) : (
          <StartPrompt meta={meta} />
        )}

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
        <LoadingNote slowHint="Still waiting for the server.">Loading the dataset…</LoadingNote>
      </main>
    );
  }
  if (meta.isError) {
    return (
      <main className={styles.state}>
        <ErrorNote
          error={meta.error}
          onRetry={() => void meta.refetch()}
          retrying={meta.isFetching}
        />
      </main>
    );
  }
  return <Workspace meta={meta.data} />;
}
