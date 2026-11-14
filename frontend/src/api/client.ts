import createClient from 'openapi-fetch';
import { API_BASE_URL } from './config';
import type { paths } from './schema';

/**
 * Типизированный клиент API: пути, тела запросов и ответы проверяются по контракту.
 * fetch вызывается через globalThis в момент запроса, чтобы моки в тестах успели его подменить.
 */
export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
  fetch: (request) => globalThis.fetch(request),
});
