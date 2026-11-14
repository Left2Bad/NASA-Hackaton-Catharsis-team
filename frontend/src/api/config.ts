const DEFAULT_API_URL = 'http://localhost:8000/api/v1';

/** true — запросы перехватывает Mock Service Worker и отвечает примерами из contract/examples. */
export const USE_MOCKS: boolean = __API_MOCKS__;

/**
 * Базовый адрес API. В режиме моков запросы идут на свой же адрес страницы,
 * поэтому приложение не зависит от того, запущен ли бэкенд.
 */
export const API_BASE_URL: string = USE_MOCKS
  ? `${window.location.origin}/api/v1`
  : (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');
