import type { ErrorCode, ErrorResponse } from './types';

/**
 * Failures the contract does not describe, because they happen before or outside the API:
 * `NETWORK` (no connection, the server is down, CORS), `TIMEOUT` (no answer in time),
 * `UNKNOWN` (an answer that is not in the contract format, for example from a proxy).
 */
export type ClientErrorCode = 'NETWORK' | 'TIMEOUT' | 'UNKNOWN';

/** A failed request in one shape: a code, a technical message and the HTTP status (0 without one). */
export class ApiError extends Error {
  readonly code: ErrorCode | ClientErrorCode;
  readonly status: number;

  constructor(code: ErrorCode | ClientErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/** Turns an error response body into an ApiError; an unknown body gets the code UNKNOWN. */
export function toApiError(body: unknown, response: Response): ApiError {
  if (isErrorResponse(body)) {
    return new ApiError(body.error.code, body.error.message, response.status);
  }
  return new ApiError('UNKNOWN', `Request failed with status ${response.status}`, response.status);
}

/**
 * Whether asking again can help. A lost connection, a timeout and a server fault can pass;
 * a request the server understood and refused (too large an area, an invalid shape,
 * no data) will be refused again.
 */
export function isRetryable(error: Error): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === 'NETWORK' || error.code === 'TIMEOUT') return true;
  return error.status >= 500;
}
