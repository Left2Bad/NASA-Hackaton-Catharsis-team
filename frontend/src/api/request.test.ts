import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { describe, expect, it } from 'vitest';
import healthExample from '../../../contract/examples/health.json';
import { api } from './client';
import { ApiError, isRetryable } from './errors';
import { shouldRetry } from './queryClient';
import { request } from './request';
import { server } from '../mocks/server';

const getHealth = (signal?: AbortSignal, timeoutMs?: number) =>
  request((s) => api.GET('/health', { signal: s }), signal, timeoutMs);

/** Runs the call and returns what it threw. */
async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('the call was expected to fail');
}

describe('request', () => {
  it('returns the data of a successful call', async () => {
    await expect(getHealth()).resolves.toEqual(healthExample);
  });

  it('turns an error in the contract format into an ApiError with its code', async () => {
    server.use(
      http.get('*/api/v1/health', () =>
        HttpResponse.json(
          { error: { code: 'NO_DATA', message: 'Outside the coverage.' } },
          { status: 404 },
        ),
      ),
    );

    const error = await failure(getHealth());
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NO_DATA', status: 404, message: 'Outside the coverage.' });
  });

  it('reports a server that cannot be reached as NETWORK', async () => {
    server.use(http.get('*/api/v1/health', () => HttpResponse.error()));

    expect(await failure(getHealth())).toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('gives up after the timeout and reports TIMEOUT', async () => {
    server.use(
      http.get('*/api/v1/health', async () => {
        await delay(2000);
        return HttpResponse.json(healthExample);
      }),
    );

    const error = await failure(getHealth(undefined, 50));
    expect(error).toMatchObject({ code: 'TIMEOUT', status: 0 });
    expect(error.message).toBe('No answer within 0.05 s');
  });

  it('reports an error page that is not JSON as UNKNOWN with its status', async () => {
    server.use(
      http.get(
        '*/api/v1/health',
        () => new HttpResponse('<html>Bad gateway</html>', { status: 502 }),
      ),
    );

    expect(await failure(getHealth())).toMatchObject({ code: 'UNKNOWN', status: 502 });
  });

  it('reports a successful answer that is not JSON as UNKNOWN', async () => {
    server.use(
      http.get(
        '*/api/v1/health',
        () =>
          new HttpResponse('<html>Not the API</html>', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    expect(await failure(getHealth())).toMatchObject({ code: 'UNKNOWN', status: 0 });
  });

  it('passes a cancellation on without turning it into an error of its own', async () => {
    server.use(
      http.get('*/api/v1/health', async () => {
        await delay(2000);
        return HttpResponse.json(healthExample);
      }),
    );
    const controller = new AbortController();
    const call = getHealth(controller.signal);
    controller.abort();

    const error = await failure(call);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.name).toBe('AbortError');
  });
});

describe('isRetryable', () => {
  it('is true for failures that can pass on their own', () => {
    expect(isRetryable(new ApiError('NETWORK', '', 0))).toBe(true);
    expect(isRetryable(new ApiError('TIMEOUT', '', 0))).toBe(true);
    expect(isRetryable(new ApiError('INTERNAL', '', 500))).toBe(true);
    expect(isRetryable(new ApiError('UNKNOWN', '', 502))).toBe(true);
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('is false for requests the server understood and refused', () => {
    expect(isRetryable(new ApiError('AREA_TOO_LARGE', '', 413))).toBe(false);
    expect(isRetryable(new ApiError('INVALID_GEOMETRY', '', 400))).toBe(false);
    expect(isRetryable(new ApiError('NO_DATA', '', 404))).toBe(false);
    expect(isRetryable(new ApiError('UNKNOWN', '', 404))).toBe(false);
  });
});

describe('shouldRetry', () => {
  it('tries once more after a network or server fault', () => {
    expect(shouldRetry(0, new ApiError('NETWORK', '', 0))).toBe(true);
    expect(shouldRetry(0, new ApiError('INTERNAL', '', 500))).toBe(true);
    expect(shouldRetry(1, new ApiError('NETWORK', '', 0))).toBe(false);
  });

  it('does not repeat a refused request or a timeout on its own', () => {
    expect(shouldRetry(0, new ApiError('AREA_TOO_LARGE', '', 413))).toBe(false);
    expect(shouldRetry(0, new ApiError('TIMEOUT', '', 0))).toBe(false);
  });
});
