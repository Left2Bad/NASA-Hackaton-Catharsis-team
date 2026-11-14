import type { ErrorCode, ErrorResponse } from './types';

/** Ошибка API в едином виде: код из контракта, текст сервера и статус HTTP. */
export class ApiError extends Error {
  readonly code: ErrorCode | 'UNKNOWN';
  readonly status: number;

  constructor(code: ErrorCode | 'UNKNOWN', message: string, status: number) {
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

/** Превращает тело ответа с ошибкой в ApiError; незнакомое тело даёт код UNKNOWN. */
export function toApiError(body: unknown, response: Response): ApiError {
  if (isErrorResponse(body)) {
    return new ApiError(body.error.code, body.error.message, response.status);
  }
  return new ApiError('UNKNOWN', `Request failed with status ${response.status}`, response.status);
}
