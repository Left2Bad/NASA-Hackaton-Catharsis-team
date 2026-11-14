import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { toApiError } from './errors';
import type { AreaQuery, CalendarResponse, CurrentResponse, Geometry, Meta } from './types';

// openapi-fetch returns coordinates as number[], while the contract defines a pair
// [longitude, latitude]. The `as` cast gives the response its exact schema type back.

export async function fetchMeta(): Promise<Meta> {
  const { data, error, response } = await api.GET('/meta');
  if (data === undefined) throw toApiError(error, response);
  return data as Meta;
}

export async function fetchCalendar(query: AreaQuery): Promise<CalendarResponse> {
  const { data, error, response } = await api.POST('/calendar', { body: query });
  if (data === undefined) throw toApiError(error, response);
  return data as CalendarResponse;
}

export async function fetchCurrent(query: AreaQuery): Promise<CurrentResponse> {
  const { data, error, response } = await api.POST('/current', { body: query });
  if (data === undefined) throw toApiError(error, response);
  return data as CurrentResponse;
}

/** Dataset metadata: date range, sources, limits, example areas. */
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: Infinity });
}

/** Calendar for an area. Nothing loads while there is no query (`null`). */
export function useCalendar(query: AreaQuery | null) {
  return useQuery({
    queryKey: ['calendar', query],
    queryFn: () => fetchCalendar(query as AreaQuery),
    enabled: query !== null,
  });
}

/**
 * The current month so far for an area. The request carries only the geometry: the period
 * of the calendar does not apply to "now". Nothing loads while there is no area (`null`).
 */
export function useCurrent(geometry: Geometry | null) {
  return useQuery({
    queryKey: ['current', geometry],
    queryFn: () => fetchCurrent({ geometry: geometry as Geometry }),
    enabled: geometry !== null,
  });
}
