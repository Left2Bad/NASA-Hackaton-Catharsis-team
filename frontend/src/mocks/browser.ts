import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** Моки для браузера: сервис-воркер из public/mockServiceWorker.js. */
export const worker = setupWorker(...handlers);
