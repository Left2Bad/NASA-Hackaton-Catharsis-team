import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Моки для тестов в Node: те же обработчики, что и в браузере. */
export const server = setupServer(...handlers);
