import { useEffect, useMemo, useRef, useState } from 'react';
import { USE_MOCKS } from '../api/config';
import { FALLBACK_MODE } from '../api/snapshot';
import { useCalendar, useCurrent, useMeta, usePointsSpan } from '../api/queries';
import type { Geometry, Meta, MonthValue } from '../api/types';
import { AreaMap } from '../components/AreaMap';
import { BurnCalendar, type CalendarMode } from '../components/BurnCalendar';
import { CoordinateForm } from '../components/CoordinateForm';
import { DailyCalendar } from '../components/DailyCalendar';
import { Downloads } from '../components/Downloads';
import { ErrorNote } from '../components/ErrorNote';
import { LoadingNote } from '../components/LoadingNote';
import { NowPanel } from '../components/NowPanel';
import { PeriodSelect, type Period } from '../components/PeriodSelect';
import { SeasonProfile } from '../components/SeasonProfile';
import { SectionNav, type PanelSection } from '../components/SectionNav';
import { SpotsBar } from '../components/SpotsBar';
import { SummaryFacts } from '../components/SummaryFacts';
import { YearlyTotals } from '../components/YearlyTotals';
import { boundsOf, formatBounds } from '../geo/geometry';
import { areaKm2 } from '../geo/shapes';
import { formatNumber, monthName, presetLabel, WARNING_LABELS } from '../labels';
import {
  calendarCount,
  frpBreaks,
  frpColors,
  mergePoints,
  monthId,
  monthIndex,
  spanMonths,
} from '../map/spots';
import { nowHeadline } from '../now/describe';
import { buildSearch, currentSearch, onLinkChange, parseSearch, writeSearch } from '../state/link';
import { defaultSpotsMonth } from '../state/spots';
import { roundSignificant } from '../theme/scales';
import styles from './CalendarScreen.module.css';

/** How long the months slider must rest before its months are asked for, ms. */
const SPAN_SETTLE_MS = 400;

// The main screen: the map with area selection on the left, the panel with the
// calendar, the analytics and the downloads on the right.

/** The area of interest: its shape and, when it came from an example, which one. */
interface Area {
  geometry: Geometry;
  presetId: string | null;
}

/**
 * The calendar request of an area, or `null` for an area above the limit: the server would
 * refuse it anyway (F5). The panel and the default hot spots ask the same query, so React Query
 * sends it once.
 */
function calendarQuery(area: Area, period: Period, mode: CalendarMode, tooLarge: boolean) {
  return tooLarge
    ? null
    : {
        geometry: area.geometry,
        start_year: period.startYear,
        end_year: period.endYear,
        // The counts of the sensors as they recorded are asked only for the view that shows them.
        ...(mode === 'raw' ? { series: 'raw' as const } : {}),
      };
}

/** Shown before any area is chosen: tells the user how to start. */
function StartPrompt({ meta }: { meta: Meta }) {
  // The first month of the record comes from the dataset, not from the text.
  const [firstYear, firstMonth] = meta.first_date.split('-').map(Number);
  return (
    <div className={styles.start}>
      <h1>Choose an area to see its fire calendar</h1>
      <ol>
        <li>
          <strong>Choose an area.</strong> Pick an example above the map, draw a rectangle or a
          polygon on it, or enter coordinates.
        </li>
        <li>
          <strong>Read its calendar.</strong> Fire activity for every month since{' '}
          {monthName(firstMonth)} {firstYear}, on one scale across MODIS and VIIRS.
        </li>
        <li>
          <strong>Compare and export.</strong> The current month against the median of past years,
          anomalies and trends; tables as CSV, charts as PNG.
        </li>
      </ol>
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
  /** The months whose hot spots are on the map, as "2020-09". */
  selectedMonths: ReadonlySet<string>;
  /** Absent where single detections are not available: a copy of the app without a server. */
  onSelectMonth?: (month: MonthValue) => void;
}

function AreaPanel({
  area,
  meta,
  period,
  mode,
  onModeChange,
  selectedMonths,
  onSelectMonth,
}: AreaPanelProps) {
  const sizeKm2 = areaKm2(area.geometry);
  const limitKm2 = meta.limits.max_area_km2;
  const tooLarge = sizeKm2 > limitKm2;

  const calendar = useCalendar(calendarQuery(area, period, mode, tooLarge));

  // "Now" does not depend on the chosen period, so it is asked for the geometry alone
  // and is not asked again when the period changes.
  const current = useCurrent(tooLarge ? null : area.geometry);

  const data = calendar.data;
  // Only the period or the series changed: the previous calendar stays on screen, dimmed,
  // until the new one arrives.
  const updating = calendar.isPlaceholderData;
  // An area without fires is a valid answer (200 with zeros), not an error.
  const empty = data !== undefined && data.summary.total === 0;

  const headline = current.data ? nowHeadline(current.data) : null;

  // Jump links to the sections that are on screen.
  const sections: PanelSection[] =
    data && !empty
      ? [
          { id: 'calendar-heading', label: 'Calendar' },
          { id: 'summary-heading', label: 'Summary' },
          { id: 'now-heading', label: 'Now' },
          { id: 'season-heading', label: 'Season' },
          { id: 'yearly-heading', label: 'Years' },
          { id: 'daily-heading', label: 'Days' },
          { id: 'downloads-heading', label: 'Downloads' },
        ]
      : [];

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
            {updating && <span role="status"> · updating…</span>}
          </p>
        )}
        <CopyLink />
        {data && (
          <details className={styles.about}>
            <summary>What is counted</summary>
            <p>
              Active fire detections (hot spots) from NASA FIRMS, in VIIRS Suomi NPP equivalents.
              Counts of MODIS and of VIIRS NOAA-20 are multiplied by coefficients fitted for every
              1° cell, so values can be fractional. Low-confidence detections and static sources
              (volcanoes, gas flares, industry) are left out. Medians, anomalies and levels use{' '}
              {data.baseline.start_year} to {data.baseline.end_year} as the baseline.{' '}
              <a href="#/method">How the record is made</a>
            </p>
          </details>
        )}
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
      {headline && !calendar.isError && (
        // The answer most readers come for stands first; the "Now" section has the details.
        <p className={styles.headline} data-testid="now-headline">
          <span className={styles.headlineLabel}>{headline.label}</span>
          <span className={styles.headlineLevel}>
            {headline.color && (
              <span className={styles.headlineSwatch} style={{ background: headline.color }} />
            )}
            {headline.level && <strong>{headline.level}</strong>}
            <span>{headline.detail}</span>
          </span>
        </p>
      )}

      <SectionNav sections={sections} />

      {data && !empty && (
        <div className={styles.results} aria-busy={updating}>
          <section className={styles.section} aria-labelledby="calendar-heading">
            <h2 id="calendar-heading">Burn calendar</h2>
            <BurnCalendar
              calendar={data}
              sources={meta.sources}
              mode={mode}
              onModeChange={onModeChange}
              selectedMonths={selectedMonths}
              onSelectMonth={onSelectMonth}
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

      {!tooLarge && !calendar.isError && (
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

          <section className={styles.section} aria-labelledby="daily-heading">
            <h2 id="daily-heading">Daily calendar</h2>
            <DailyCalendar
              geometry={area.geometry}
              years={data.yearly.map((year) => year.year).reverse()}
            />
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
  const range = useMemo<Period>(
    () => ({
      startYear: Number(meta.first_date.slice(0, 4)),
      endYear: Number(meta.last_date.slice(0, 4)),
    }),
    [meta.first_date, meta.last_date],
  );
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
  // The months whose hot spots are on the map (F13), as month indexes. They are kept with
  // their area, so the dots of one area are never drawn over another.
  const [spots, setSpots] = useState<{ geometry: Geometry; first: number; last: number } | null>(
    null,
  );
  // The weakest fire that is drawn, in MW: a click on the legend of fire power sets it.
  const [minFrp, setMinFrp] = useState(0);
  // The area whose hot spots the user hid: its default month is not shown again.
  const [hiddenFor, setHiddenFor] = useState<Geometry | null>(null);
  const tooLarge = area !== null && areaKm2(area.geometry) > meta.limits.max_area_km2;
  // Without a month picked, the map shows the latest month with fire, so the dots are there
  // as soon as an area is open. A copy of the app without a server has no single detections.
  const calendar = useCalendar(area ? calendarQuery(area, period, mode, tooLarge) : null);
  const latest =
    area && FALLBACK_MODE !== 'only' && hiddenFor !== area.geometry && !calendar.isPlaceholderData
      ? defaultSpotsMonth(calendar.data?.months ?? [])
      : null;
  const pickedSpots = spots !== null && spots.geometry === area?.geometry ? spots : null;
  const shownSpots =
    pickedSpots ??
    (area && latest
      ? {
          geometry: area.geometry,
          first: monthIndex(latest.year, latest.month),
          last: monthIndex(latest.year, latest.month),
        }
      : null);
  const spanOfSpots = useMemo(
    () => (shownSpots ? spanMonths(shownSpots.first, shownSpots.last) : []),
    // The span is two numbers: the list is rebuilt only when one of them changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownSpots?.first, shownSpots?.last],
  );
  // The months asked for while the slider moves: the span it last rested at. Dragging passes
  // many spans in a second, and every month is a heavy query on the server; a burst of them
  // once exhausted its memory. Clicks on the calendar are asked for at once.
  const [settledSpan, setSettledSpan] = useState<{ first: number; last: number } | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);
  const requestedSpan = useMemo(
    () =>
      pickedSpots && settledSpan ? spanMonths(settledSpan.first, settledSpan.last) : spanOfSpots,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickedSpots !== null, settledSpan?.first, settledSpan?.last, spanOfSpots],
  );
  const points = usePointsSpan(shownSpots && !tooLarge ? shownSpots.geometry : null, requestedSpan);
  // While the slider has not rested, the map keeps the dots it has and the strip says the
  // months it shows are still loading.
  const spanSettled =
    !pickedSpots ||
    !settledSpan ||
    (settledSpan.first === pickedSpots.first && settledSpan.last === pickedSpots.last);
  // Several months become one collection; above the limit the strongest fires are kept.
  const drawn = useMemo(
    () => (points.data ? mergePoints(points.data, meta.limits.max_points) : undefined),
    [points.data, meta.limits.max_points],
  );
  const pointStyle = useMemo(() => {
    const breaks = frpBreaks(drawn);
    return { breaks, colors: frpColors(breaks), minFrp };
  }, [drawn, minFrp]);
  // The month nobody asked for stays quiet when it cannot be loaded: the calendar already
  // reports a server that cannot be reached, and the saved demo data has no single
  // detections. Months the user picked still get their message.
  const spotsVisible = shownSpots !== null && (pickedSpots !== null || !points.isError);
  const spotsIds = useMemo(
    () =>
      new Set(
        shownSpots && spotsVisible
          ? spanMonths(shownSpots.first, shownSpots.last).map((month) =>
              monthId(monthIndex(month.year, month.month)),
            )
          : [],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownSpots?.first, shownSpots?.last, spotsVisible],
  );
  /** Shows other months: the threshold of fire power belonged to the previous ones. */
  const showSpan = (span: { first: number; last: number }) => {
    if (!area) return;
    window.clearTimeout(settleTimer.current);
    setSettledSpan(span);
    setSpots({ geometry: area.geometry, ...span });
    setHiddenFor(null);
    setMinFrp(0);
  };
  /** A click on a month shows it alone; a click on the only month shown hides it again. */
  const toggleSpots = (month: MonthValue) => {
    const index = monthIndex(month.year, month.month);
    if (shownSpots?.first === index && shownSpots.last === index) hideSpots();
    else showSpan({ first: index, last: index });
  };
  /** The slider and its arrows: the span shows at once, its months are asked for once it rests. */
  const slideSpan = (span: { first: number; last: number }) => {
    if (!area) return;
    const before = shownSpots ? { first: shownSpots.first, last: shownSpots.last } : span;
    window.clearTimeout(settleTimer.current);
    // Until it rests, the months already on the map stay the ones asked for.
    if (!pickedSpots) setSettledSpan(before);
    settleTimer.current = window.setTimeout(() => setSettledSpan(span), SPAN_SETTLE_MS);
    setSpots({ geometry: area.geometry, ...span });
    setHiddenFor(null);
    setMinFrp(0);
  };
  function hideSpots() {
    setSpots(null);
    setMinFrp(0);
    setHiddenFor(area?.geometry ?? null);
  }
  const record = {
    min: monthIndex(Number(meta.first_date.slice(0, 4)), Number(meta.first_date.slice(5, 7))),
    max: monthIndex(Number(meta.last_date.slice(0, 4)), Number(meta.last_date.slice(5, 7))),
  };

  // Every change goes back into the address, so the address always describes the screen.
  const search = buildSearch(
    { area, startYear: period.startYear, endYear: period.endYear, mode },
    range,
  );
  useEffect(() => {
    writeSearch(search);
  }, [search]);
  // A link pasted into an open tab, or "Back" to an earlier one, changes only the address:
  // the screen follows it. An address that asks for what is already shown changes nothing,
  // so the screen and the address never chase each other.
  useEffect(
    () =>
      onLinkChange((next) => {
        const asked = parseSearch(next, meta, range);
        if (buildSearch(asked, range) === search) {
          writeSearch(search);
          return;
        }
        // The same area keeps the months picked on its map.
        const areaOnly = (value: Area | null) => buildSearch({ ...asked, area: value }, range);
        if (areaOnly(asked.area) !== areaOnly(area)) setArea(asked.area);
        setPeriod({ startYear: asked.startYear, endYear: asked.endYear });
        setMode(asked.mode);
      }),
    [search, meta, range, area],
  );

  return (
    <main className={styles.screen}>
      <section className={styles.mapColumn} aria-label="Area selection">
        <div className={styles.areaBar}>
          <div className={styles.presets} role="group" aria-label="Example areas">
            <span className={styles.barLabel} aria-hidden="true">
              Examples
            </span>
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
        {shownSpots && spotsVisible && area && (
          <SpotsBar
            geometry={shownSpots.geometry}
            presetId={area.presetId}
            span={{ first: shownSpots.first, last: shownSpots.last }}
            record={record}
            meta={meta}
            points={spanSettled ? drawn : undefined}
            calendarCount={
              // In "Original sensors" the cells show each sensor's own count, not this number.
              calendar.data && mode !== 'raw'
                ? calendarCount(calendar.data.months, shownSpots.first, shownSpots.last)
                : null
            }
            breaks={pointStyle.breaks}
            minFrp={minFrp}
            error={points.isError ? points.error : null}
            onRetry={points.refetch}
            retrying={points.isFetching}
            onSpanChange={slideSpan}
            onMinFrpChange={setMinFrp}
            onHide={hideSpots}
          />
        )}
        <div className={styles.mapSlot}>
          <AreaMap
            geometry={area?.geometry ?? null}
            points={spotsVisible ? (drawn ?? null) : null}
            pointStyle={pointStyle}
            // A shape drawn or edited on the map is no longer an example area.
            onChange={(geometry) => setArea(geometry ? { geometry, presetId: null } : null)}
          />
        </div>
      </section>

      <section className={styles.panel} aria-label="Fire activity">
        {area ? (
          <AreaPanel
            area={area}
            meta={meta}
            period={period}
            mode={mode}
            onModeChange={setMode}
            selectedMonths={spotsIds}
            // Single detections do not fit into the saved answers, so a copy of the app
            // that never asks a server does not offer them.
            onSelectMonth={FALLBACK_MODE === 'only' ? undefined : toggleSpots}
          />
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
