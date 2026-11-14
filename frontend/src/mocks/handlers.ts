import { delay } from 'msw';
import { http, HttpResponse, type HttpHandler } from 'msw/http';
import calendar from '../../../contract/examples/calendar.response.json';
import calendarRaw from '../../../contract/examples/calendar_raw.response.json';
import current from '../../../contract/examples/current.response.json';
import daily from '../../../contract/examples/daily.response.json';
import exportCalendarCsv from '../../../contract/examples/export_calendar.csv?raw';
import exportPointsCsv from '../../../contract/examples/export_points.csv?raw';
import health from '../../../contract/examples/health.json';
import meta from '../../../contract/examples/meta.json';
import validation from '../../../contract/examples/method_validation.response.json';
import points from '../../../contract/examples/points.response.json';
import type { paths } from '../api/schema';
import type { AreaQuery } from '../api/types';

// The mocks answer with the examples from contract/examples. CI checks those files against
// the contract (contract/tools/validate.py), so they are returned here as they are.
// The numbers in the examples are synthetic and the same for every area.

/** URL pattern: any host, the /api/v1 prefix. */
const url = (path: keyof paths) => `*/api/v1${path}`;

const csv = (body: string, filename: string) =>
  new HttpResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });

// `satisfies` requires a handler for every path of the contract:
// a new endpoint in openapi.yaml without a mock fails the type check.
const routes = {
  '/health': http.get(url('/health'), () => HttpResponse.json(health)),

  '/meta': http.get(url('/meta'), async () => {
    await delay();
    return HttpResponse.json(meta);
  }),

  '/calendar': http.post(url('/calendar'), async ({ request }) => {
    const query = (await request.json()) as AreaQuery;
    await delay();
    return HttpResponse.json(query.series === 'raw' ? calendarRaw : calendar);
  }),

  '/current': http.post(url('/current'), async () => {
    await delay();
    return HttpResponse.json(current);
  }),

  '/points': http.post(url('/points'), async () => {
    await delay();
    return HttpResponse.json(points);
  }),

  '/daily': http.post(url('/daily'), async () => {
    await delay();
    return HttpResponse.json(daily);
  }),

  '/export/points.csv': http.post(url('/export/points.csv'), () =>
    csv(exportPointsCsv, 'hotspots.csv'),
  ),

  '/export/calendar.csv': http.post(url('/export/calendar.csv'), () =>
    csv(exportCalendarCsv, 'calendar.csv'),
  ),

  '/method/validation': http.get(url('/method/validation'), async () => {
    await delay();
    return HttpResponse.json(validation);
  }),
} satisfies Record<keyof paths, HttpHandler>;

export const handlers: HttpHandler[] = Object.values(routes);
