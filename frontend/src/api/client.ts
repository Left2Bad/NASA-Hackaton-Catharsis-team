import createClient from 'openapi-fetch';
import { API_BASE_URL } from './config';
import type { paths } from './schema';

/**
 * Typed API client: paths, request bodies and responses are checked against the contract.
 * fetch is read from globalThis at call time, so test mocks can replace it first.
 */
export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
  fetch: (request) => globalThis.fetch(request),
});
