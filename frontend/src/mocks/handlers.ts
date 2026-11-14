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

// Моки отвечают примерами из contract/examples. Эти файлы проверяются на соответствие
// контракту в CI (contract/tools/validate.py), поэтому здесь они отдаются как есть.
// Числа в примерах синтетические и одинаковы для любой области.

/** Шаблон адреса: любой хост, префикс /api/v1. */
const url = (path: keyof paths) => `*/api/v1${path}`;

const csv = (body: string, filename: string) =>
  new HttpResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });

// `satisfies` требует обработчик для каждого пути контракта:
// новый эндпоинт в openapi.yaml без мока не пройдёт проверку типов.
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
