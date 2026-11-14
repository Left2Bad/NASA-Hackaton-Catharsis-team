const DEFAULT_API_URL = 'http://localhost:8000/api/v1';

/** true: Mock Service Worker intercepts requests and answers with contract/examples. */
export const USE_MOCKS: boolean = __API_MOCKS__;

/**
 * Base address of the API. In mock mode requests go to the page's own origin,
 * so the app does not depend on the backend running.
 */
export const API_BASE_URL: string = USE_MOCKS
  ? `${window.location.origin}/api/v1`
  : (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');
