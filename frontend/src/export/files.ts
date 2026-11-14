import type { Geometry, Meta } from '../api/types';
import { boundsOf } from '../geo/geometry';

// Names and dates of the files the user downloads (requirements F22 to F24).

/** What a download is about: the area and the years. */
export interface ExportScope {
  geometry: Geometry;
  /** `id` of the example area, or `null` for a drawn or typed one. */
  presetId: string | null;
  startYear: number;
  endYear: number;
}

/** A coordinate for a file name: "61E", "7.5S". No degree sign and no minus. */
function axis(value: number, positive: string, negative: string): string {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  return `${rounded}${value < 0 ? negative : positive}`;
}

/** The area as a piece of a file name: the example `id`, or the bounds of a custom area. */
export function areaSlug(scope: Pick<ExportScope, 'geometry' | 'presetId'>): string {
  if (scope.presetId) return scope.presetId;
  const { west, south, east, north } = boundsOf(scope.geometry);
  return `${axis(west, 'E', 'W')}-${axis(east, 'E', 'W')}_${axis(south, 'N', 'S')}-${axis(north, 'N', 'S')}`;
}

/** The years as a piece of a file name: "2000-2025", or "2015" for a single year. */
export const yearsSlug = ({ startYear, endYear }: Pick<ExportScope, 'startYear' | 'endYear'>) =>
  startYear === endYear ? String(startYear) : `${startYear}-${endYear}`;

/**
 * The file name of a download: what it is, where, when, and the extension.
 * The name carries the data source, because a CSV has no room for it (a comment line
 * at the top would break opening the file in a spreadsheet).
 */
export function exportFileName(kind: string, scope: ExportScope, extension: string): string {
  return `firms-${kind}_${areaSlug(scope)}_${yearsSlug(scope)}.${extension}`;
}

/** The file name of the current-month image: the month takes the place of the years. */
export function nowFileName(
  scope: Pick<ExportScope, 'geometry' | 'presetId'>,
  year: number,
  month: number,
): string {
  return `firms-current-month_${areaSlug(scope)}_${year}-${String(month).padStart(2, '0')}.png`;
}

/**
 * The dates of a hot spot export for a period given in years: January 1 of the first year
 * to December 31 of the last one, but never outside the record of the dataset.
 */
export function exportDates(
  scope: Pick<ExportScope, 'startYear' | 'endYear'>,
  meta: Pick<Meta, 'first_date' | 'last_date'>,
): { start_date: string; end_date: string } {
  const start = `${scope.startYear}-01-01`;
  const end = `${scope.endYear}-12-31`;
  // ISO dates compare correctly as strings.
  return {
    start_date: start < meta.first_date ? meta.first_date : start,
    end_date: end > meta.last_date ? meta.last_date : end,
  };
}

/** The file name of a hot spot export: the years of the period, or the dates when they were set by hand. */
export function hotspotsFileName(
  scope: ExportScope,
  dates: { start_date: string; end_date: string },
  meta: Pick<Meta, 'first_date' | 'last_date'>,
): string {
  const whole = exportDates(scope, meta);
  if (dates.start_date === whole.start_date && dates.end_date === whole.end_date) {
    return exportFileName('hotspots', scope, 'csv');
  }
  return `firms-hotspots_${areaSlug(scope)}_${dates.start_date}_${dates.end_date}.csv`;
}

/** The first and the last day of a month, never outside the record of the dataset. */
export function monthDates(
  year: number,
  month: number,
  meta: Pick<Meta, 'first_date' | 'last_date'>,
): { start_date: string; end_date: string } {
  const id = `${year}-${String(month).padStart(2, '0')}`;
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = `${id}-01`;
  const end = `${id}-${String(lastDay).padStart(2, '0')}`;
  return {
    start_date: start < meta.first_date ? meta.first_date : start,
    end_date: end > meta.last_date ? meta.last_date : end,
  };
}

/** The file name of the hot spots of one month: "firms-hotspots_kz-steppe_2020-09.csv". */
export function monthFileName(
  scope: Pick<ExportScope, 'geometry' | 'presetId'>,
  year: number,
  month: number,
): string {
  return `firms-hotspots_${areaSlug(scope)}_${year}-${String(month).padStart(2, '0')}.csv`;
}

/**
 * The file name of the hot spots of a span of months, given as month indexes
 * (year × 12 + month − 1): one month or "first_last".
 */
export function spanFileName(
  scope: Pick<ExportScope, 'geometry' | 'presetId'>,
  first: number,
  last: number,
): string {
  const id = (index: number) =>
    `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  const months = first === last ? id(first) : `${id(first)}_${id(last)}`;
  return `firms-hotspots_${areaSlug(scope)}_${months}.csv`;
}

/** Hands a file to the browser's download: a temporary link that is clicked and removed. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the next task; the memory behind the link can go.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
