import { ApiError, toApiError } from './errors';

/** How long a request may take. The first calendar of a large area can need several seconds. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** What the typed client returns for one call. */
interface ClientResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Runs one API call and gives back its data, or throws an ApiError that says what went wrong.
 *
 * - `signal` comes from the query library: when the answer is no longer needed (the user
 *   picked another area), the request is cancelled and the abort is passed on untouched.
 * - A request that outlives `timeoutMs` is cancelled and reported as `TIMEOUT`.
 * - A request that never got an answer (server down, no network, CORS) is `NETWORK`.
 * - An answer that is not JSON, for example a proxy page, is `UNKNOWN`.
 */
export async function request<T>(
  send: (signal: AbortSignal) => Promise<ClientResult<T>>,
  signal?: AbortSignal,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let result: ClientResult<T>;
  try {
    result = await send(combined);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    if (timeout.aborted) {
      throw new ApiError('TIMEOUT', `No answer within ${timeoutMs / 1000} s`, 0);
    }
    if (cause instanceof SyntaxError) {
      throw new ApiError('UNKNOWN', 'The answer is not valid JSON', 0);
    }
    throw new ApiError('NETWORK', cause instanceof Error ? cause.message : 'Network error', 0);
  }
  if (result.data === undefined) throw toApiError(result.error, result.response);
  return result.data;
}
