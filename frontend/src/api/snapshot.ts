import { useSyncExternalStore } from 'react';
import { USE_MOCKS } from './config';
import { ApiError } from './errors';
import type {
  AreaQuery,
  CalendarResponse,
  CurrentResponse,
  Geometry,
  Meta,
  ValidationResponse,
} from './types';

// The fallback mode: answers of the real API saved as static files next to the app
// (public/snapshot/, written by scripts/snapshot.mjs). When the server cannot be reached,
// the app shows them instead, so a demo survives a server that is down. The snapshot
// holds the example areas only; the numbers are real, not synthetic.

/**
 * `auto`: ask the server, use the snapshot when it cannot be reached.
 * `only`: never ask the server (a static deployment without a backend).
 * `off`: never use the snapshot.
 */
export type FallbackMode = 'auto' | 'only' | 'off';

function readMode(): FallbackMode {
  const value: unknown = import.meta.env.VITE_API_FALLBACK;
  if (value === 'auto' || value === 'only' || value === 'off') return value;
  // The mocks already answer every request, so they need no fallback.
  return USE_MOCKS ? 'off' : 'auto';
}

export const FALLBACK_MODE: FallbackMode = readMode();

/** What the snapshot is: when it was saved and from which data. */
export interface SnapshotIndex {
  created_at: string;
  data_version: string;
  areas: string[];
}

// ---------- Whether the app is showing saved answers right now ----------

let active = false;
const listeners = new Set<() => void>();

function setActive(next: boolean) {
  if (active === next) return;
  active = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the answers on screen come from the snapshot and not from the server. */
export function useSnapshotActive(): boolean {
  return useSyncExternalStore(subscribe, () => active);
}

// ---------- Choosing between the server and the snapshot ----------

/** A failure of the connection, as opposed to an answer the server gave on purpose. */
export function isUnreachable(error: unknown): boolean {
  // A request the app cancelled itself (the user chose another area) says nothing about
  // the server: it must not switch the app to the saved answers.
  if ((error as { name?: unknown } | null)?.name === 'AbortError') return false;
  if (!(error instanceof ApiError)) return true;
  if (error.code === 'NETWORK' || error.code === 'TIMEOUT') return true;
  // A gateway in front of a stopped server answers 502 to 504 with its own page.
  return error.code === 'UNKNOWN' && error.status >= 502;
}

/**
 * After the server failed to answer, it is not asked again for this long: a server that
 * hangs would otherwise make every request wait for its timeout before the saved answer.
 */
export const SKIP_SERVER_MS = 60_000;
let skipServerUntil = 0;

/** Forgets that the server was unreachable, so the next request asks it again. */
export function retryServer(): void {
  skipServerUntil = 0;
}

/**
 * Asks the server and falls back to the snapshot when it cannot be reached.
 * An error the server returned on purpose (too large an area, no data) is never replaced.
 */
export async function withFallback<T>(
  live: () => Promise<T>,
  saved: () => Promise<T>,
  mode: FallbackMode = FALLBACK_MODE,
): Promise<T> {
  if (mode === 'only' || (mode === 'auto' && Date.now() < skipServerUntil)) {
    setActive(true);
    return saved();
  }
  try {
    const data = await live();
    setActive(false);
    return data;
  } catch (error) {
    if (mode === 'off' || !isUnreachable(error)) throw error;
    skipServerUntil = Date.now() + SKIP_SERVER_MS;
    const data = await saved();
    setActive(true);
    return data;
  }
}

// ---------- Reading the snapshot ----------

async function load<T>(name: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}snapshot/${name}.json`, { signal });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError('NETWORK', 'The saved answers could not be loaded', 0);
  }
  // A static host answers a missing file with 404, or with the page of the app itself.
  if (!response.ok || !(response.headers.get('Content-Type') ?? '').includes('json')) {
    throw new ApiError('NETWORK', `No saved answer "${name}"`, 0);
  }
  return (await response.json()) as T;
}

/** The example area a geometry belongs to, or `null` for a drawn or typed area. */
export function presetIdOf(geometry: Geometry, meta: Pick<Meta, 'presets'>): string | null {
  const wanted = JSON.stringify(geometry);
  return meta.presets.find((preset) => JSON.stringify(preset.geometry) === wanted)?.id ?? null;
}

/** The snapshot has only the example areas: any other area gets this error. */
function offlineArea(): ApiError {
  return new ApiError('OFFLINE', 'The saved answers hold the example areas only', 0);
}

const MIN_YEARS_FOR_TREND = 10;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The trend of yearly totals as the API computes it (backend/app/stats.py): a least-squares
 * line over the complete years, its slope in % of the mean per decade, and its two ends.
 */
export function trendOf(
  years: readonly { year: number; total: number }[],
): Pick<CalendarResponse['summary'], 'trend_pct_per_decade' | 'trend_line'> {
  const none = { trend_pct_per_decade: null, trend_line: null };
  if (years.length < MIN_YEARS_FOR_TREND) return none;
  const count = years.length;
  const meanX = years.reduce((sum, item) => sum + item.year, 0) / count;
  const meanY = years.reduce((sum, item) => sum + item.total, 0) / count;
  if (meanY === 0) return none;
  const slope =
    years.reduce((sum, item) => sum + (item.year - meanX) * (item.total - meanY), 0) /
    years.reduce((sum, item) => sum + (item.year - meanX) ** 2, 0);
  const at = (year: number) => meanY + slope * (year - meanX);
  const first = years[0].year;
  const last = years[count - 1].year;
  return {
    trend_pct_per_decade: round1(((slope * 10) / meanY) * 100),
    trend_line: {
      start_year: first,
      start_value: round1(at(first)),
      end_year: last,
      end_value: round1(at(last)),
    },
  };
}

/**
 * A saved calendar of the whole record cut to the requested years. Everything that
 * depends on the period is computed again the way the API does it; the baseline, the
 * percentiles and the levels of the months do not depend on the period and stay.
 */
export function tailorPeriod(saved: CalendarResponse, query: AreaQuery): CalendarResponse {
  const firstYear = query.start_year ?? Number.NEGATIVE_INFINITY;
  const lastYear = query.end_year ?? Number.POSITIVE_INFINITY;
  const inPeriod = (year: number) => year >= firstYear && year <= lastYear;

  const months = saved.months.filter((month) => inPeriod(month.year));
  const yearly = saved.yearly.filter((year) => inPeriod(year.year));
  if (months.length === saved.months.length) return saved;

  const complete = yearly.filter((year) => year.complete);
  const peak = complete.reduce<(typeof complete)[number] | null>(
    (best, year) => (best === null || year.total > best.total ? year : best),
    null,
  );
  return {
    ...saved,
    months,
    yearly,
    summary: {
      ...saved.summary,
      peak_year: peak && peak.total > 0 ? peak.year : null,
      total: round1(months.reduce((sum, month) => sum + month.value, 0)),
      ...trendOf(complete),
    },
  };
}

const CSV_COLUMNS = [
  'year',
  'month',
  'value',
  'low',
  'high',
  'median',
  'anomaly_pct',
  'percentile',
  'category',
  'source',
  'preliminary',
  'partial',
] as const;

/** The monthly table as CSV, in the columns and the format of `POST /export/calendar.csv`. */
export function calendarCsv(calendar: CalendarResponse): string {
  const rows = calendar.months.map((month) =>
    CSV_COLUMNS.map((column) => {
      const value = month[column];
      return value === null ? '' : String(value);
    }).join(','),
  );
  return `${[CSV_COLUMNS.join(','), ...rows].join('\n')}\n`;
}

/** The saved answers, each in the shape of the API response it stands in for. */
export const snapshot = {
  index: (signal?: AbortSignal) => load<SnapshotIndex>('index', signal),
  meta: (signal?: AbortSignal) => load<Meta>('meta', signal),
  validation: (signal?: AbortSignal) => load<ValidationResponse>('validation', signal),

  async calendar(query: AreaQuery, signal?: AbortSignal): Promise<CalendarResponse> {
    const id = presetIdOf(query.geometry, await load<Meta>('meta', signal));
    if (id === null) throw offlineArea();
    return tailorPeriod(await load<CalendarResponse>(`calendar_${id}`, signal), query);
  },

  async current(query: AreaQuery, signal?: AbortSignal): Promise<CurrentResponse> {
    const id = presetIdOf(query.geometry, await load<Meta>('meta', signal));
    if (id === null) throw offlineArea();
    return load<CurrentResponse>(`current_${id}`, signal);
  },

  async calendarCsv(query: AreaQuery, signal?: AbortSignal): Promise<Blob> {
    const calendar = await snapshot.calendar(query, signal);
    return new Blob([calendarCsv(calendar)], { type: 'text/csv; charset=utf-8' });
  },
};
