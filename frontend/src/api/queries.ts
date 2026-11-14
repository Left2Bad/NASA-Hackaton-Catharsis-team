import { useQuery, type Query } from '@tanstack/react-query';
import { api } from './client';
import { ApiError } from './errors';
import { request } from './request';
import { snapshot, withFallback } from './snapshot';
import type {
  AreaQuery,
  CalendarResponse,
  CurrentResponse,
  ExportPointsQuery,
  Geometry,
  Meta,
  ValidationResponse,
} from './types';

// openapi-fetch returns coordinates as number[], while the contract defines a pair
// [longitude, latitude]. The `as` cast gives the response its exact schema type back.

// Every fetcher takes the abort signal of its query, so a request whose answer is
// no longer needed is cancelled instead of keeping the server busy.

// Every fetcher also names its saved answer: when the server cannot be reached, the app
// shows the snapshot of the example areas instead (see snapshot.ts).

export async function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return withFallback(
    async () => (await request((s) => api.GET('/meta', { signal: s }), signal)) as Meta,
    () => snapshot.meta(signal),
  );
}

export async function fetchCalendar(
  query: AreaQuery,
  signal?: AbortSignal,
): Promise<CalendarResponse> {
  return withFallback(
    async () =>
      (await request(
        (s) => api.POST('/calendar', { body: query, signal: s }),
        signal,
      )) as CalendarResponse,
    () => snapshot.calendar(query, signal),
  );
}

export async function fetchCurrent(
  query: AreaQuery,
  signal?: AbortSignal,
): Promise<CurrentResponse> {
  return withFallback(
    async () =>
      (await request(
        (s) => api.POST('/current', { body: query, signal: s }),
        signal,
      )) as CurrentResponse,
    () => snapshot.current(query, signal),
  );
}

/** Dataset metadata: date range, sources, limits, example areas. */
export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: ({ signal }) => fetchMeta(signal),
    staleTime: Infinity,
  });
}

/** The geometry a calendar query was made for, read back from its key. */
function geometryOf(query: Pick<Query, 'queryKey'> | undefined): Geometry | undefined {
  const body = query?.queryKey[1] as AreaQuery | null | undefined;
  return body?.geometry;
}

/**
 * Calendar for an area. Nothing loads while there is no query (`null`).
 *
 * When only the period changes, the previous calendar of the same area stays on screen
 * (`isPlaceholderData`) until the new one arrives, so the panel does not collapse and jump.
 * For another area nothing is kept: its numbers would be shown under the wrong name.
 */
export function useCalendar(query: AreaQuery | null) {
  return useQuery({
    queryKey: ['calendar', query],
    queryFn: ({ signal }) => fetchCalendar(query as AreaQuery, signal),
    enabled: query !== null,
    placeholderData: (previous: CalendarResponse | undefined, previousQuery) =>
      query !== null && geometryOf(previousQuery) === query.geometry ? previous : undefined,
  });
}

/**
 * The current month so far for an area. The request carries only the geometry: the period
 * of the calendar does not apply to "now". Nothing loads while there is no area (`null`).
 */
export function useCurrent(geometry: Geometry | null) {
  return useQuery({
    queryKey: ['current', geometry],
    queryFn: ({ signal }) => fetchCurrent({ geometry: geometry as Geometry }, signal),
    enabled: geometry !== null,
  });
}

export async function fetchValidation(signal?: AbortSignal): Promise<ValidationResponse> {
  return withFallback(
    () => request((s) => api.GET('/method/validation', { signal: s }), signal),
    () => snapshot.validation(signal),
  );
}

/** The results of the quality checks for the "Method" page. They change only with the dataset. */
export function useValidation() {
  return useQuery({
    queryKey: ['validation'],
    queryFn: ({ signal }) => fetchValidation(signal),
    staleTime: Infinity,
  });
}

/**
 * The whole record of an area with the raw counts of every sensor next to the harmonized
 * value (`series=raw`), for the "before and after" chart of the "Method" page.
 */
export function useRawCalendar(geometry: Geometry | null) {
  return useQuery({
    queryKey: ['calendar-raw', geometry],
    queryFn: ({ signal }) =>
      fetchCalendar({ geometry: geometry as Geometry, series: 'raw' }, signal),
    enabled: geometry !== null,
  });
}

/** Exports may take long: a hot spot file streams up to half a million rows. */
export const EXPORT_TIMEOUT_MS = 180_000;

/** The monthly table of the calendar as a CSV file (requirement F23). */
export async function fetchCalendarCsv(query: AreaQuery, signal?: AbortSignal): Promise<Blob> {
  return withFallback(
    () =>
      request(
        (s) => api.POST('/export/calendar.csv', { body: query, parseAs: 'blob', signal: s }),
        signal,
        EXPORT_TIMEOUT_MS,
      ),
    // The monthly table is in the saved calendar, so the file can be made without the server.
    () => snapshot.calendarCsv(query, signal),
  );
}

/** The hot spots of an area and a date range as a CSV file (requirement F22). */
export async function fetchPointsCsv(
  query: ExportPointsQuery,
  signal?: AbortSignal,
): Promise<Blob> {
  return withFallback(
    () =>
      request(
        (s) => api.POST('/export/points.csv', { body: query, parseAs: 'blob', signal: s }),
        signal,
        EXPORT_TIMEOUT_MS,
      ),
    // Millions of points do not fit into a snapshot: this file needs the server.
    () => Promise.reject(new ApiError('OFFLINE', 'Hot spot files are not in the saved answers', 0)),
  );
}
