import { QueryClient } from '@tanstack/react-query';
import { ApiError, isRetryable } from './errors';

/**
 * Whether a failed request is tried again on its own, before the user sees an error.
 * One silent retry covers a blip of the network or of the server. A timeout is not
 * retried silently: the user would wait twice as long, so they get the "Try again" button.
 */
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof ApiError && error.code === 'TIMEOUT') return false;
  return isRetryable(error);
}

/** The query client of the app: answers stay fresh for five minutes, so going back is instant. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
    },
  });
}
