import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { toApiError } from './errors';
import type { AreaQuery, CalendarResponse, Meta } from './types';

// Клиент openapi-fetch отдаёт координаты как number[], хотя в контракте это пара
// [долгота, широта]. Приведение `as` возвращает ответу точный тип из схемы.

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

/** Метаданные набора данных: диапазон дат, источники, лимиты, области-примеры. */
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: Infinity });
}

/** Календарь для области. Пока запроса нет (`null`), ничего не загружается. */
export function useCalendar(query: AreaQuery | null) {
  return useQuery({
    queryKey: ['calendar', query],
    queryFn: () => fetchCalendar(query as AreaQuery),
    enabled: query !== null,
  });
}
