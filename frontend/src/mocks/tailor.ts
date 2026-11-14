import type { AreaQuery, CalendarResponse, ErrorResponse, Meta } from '../api/types';
import { areaKm2, estimateCells } from '../geo/shapes';

// Makes the mock calendar react to the request the way the real API will: it honors the
// period, reports the size of the area, warns about a small area and refuses a huge one.
// The fire numbers themselves stay the synthetic ones from contract/examples.

/** Fewer complete years than this and the trend is reported as unknown. */
const MIN_YEARS_FOR_TREND = 10;

/** The 413 error for an area above the limit, or `null` when the area is acceptable. */
export function areaTooLarge(query: AreaQuery, meta: Meta): ErrorResponse | null {
  const limit = meta.limits.max_area_km2;
  if (areaKm2(query.geometry) <= limit) return null;
  return {
    error: {
      code: 'AREA_TOO_LARGE',
      message: `The area is larger than ${limit.toLocaleString('en-US')} km².`,
    },
  };
}

/** The example calendar cut to the requested years and described for the requested area. */
export function tailorCalendar(
  example: CalendarResponse,
  query: AreaQuery,
  meta: Meta,
): CalendarResponse {
  const firstYear = query.start_year ?? Number.NEGATIVE_INFINITY;
  const lastYear = query.end_year ?? Number.POSITIVE_INFINITY;
  const inPeriod = (year: number) => year >= firstYear && year <= lastYear;

  const months = example.months.filter((month) => inPeriod(month.year));
  const yearly = example.yearly.filter((year) => inPeriod(year.year));
  const complete = yearly.filter((year) => year.complete);
  const peak = complete.reduce<(typeof complete)[number] | null>(
    (best, year) => (best === null || year.total > best.total ? year : best),
    null,
  );
  const enoughYears = complete.length >= MIN_YEARS_FOR_TREND;

  const cells = estimateCells(query.geometry, meta.grid_deg);
  const warnings = example.warnings.filter((warning) => warning.code !== 'AREA_SMALL');
  if (cells < meta.limits.min_cells_warning) {
    warnings.push({ code: 'AREA_SMALL', message: 'The area covers only a few grid cells.' });
  }

  return {
    ...example,
    area_km2: Math.round(areaKm2(query.geometry)),
    cells,
    months,
    yearly,
    summary: {
      ...example.summary,
      peak_year: peak?.year ?? null,
      total: Number(months.reduce((sum, month) => sum + month.value, 0).toFixed(1)),
      trend_pct_per_decade: enoughYears ? example.summary.trend_pct_per_decade : null,
      trend_line: enoughYears ? example.summary.trend_line : null,
    },
    warnings,
  };
}
