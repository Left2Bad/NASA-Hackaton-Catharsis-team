import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** Mocks for the browser: the service worker from public/mockServiceWorker.js. */
export const worker = setupWorker(...handlers);
