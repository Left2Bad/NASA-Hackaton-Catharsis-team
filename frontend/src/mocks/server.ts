import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Mocks for tests in Node: the same handlers as in the browser. */
export const server = setupServer(...handlers);
