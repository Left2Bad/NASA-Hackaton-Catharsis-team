import type { ClientErrorCode } from './api/errors';
import type { components } from './api/schema';

// Interface labels for identifiers from the contract. Server texts come in one language,
// so the frontend keeps its own names for sources and units (see contract/README.md).
// The second language will be added here in task B14.

type SourceId = components['schemas']['Source'];

/** Short name of the lead source of the harmonized record. */
export const SOURCE_LABELS: Record<SourceId, string> = {
  MODIS_T: 'MODIS Terra',
  MODIS_TA: 'MODIS Terra + Aqua',
  VIIRS_SNPP: 'VIIRS Suomi NPP',
  VIIRS_N20: 'VIIRS NOAA-20',
};

type CategoryId = components['schemas']['Category'];

/** How a month compares with the same month of the baseline years. */
export const CATEGORY_LABELS: Record<CategoryId, string> = {
  below_normal: 'Below normal',
  normal: 'Normal',
  above_normal: 'Above normal',
  high: 'High',
  record: 'Record',
};

type WarningCode = components['schemas']['Warning']['code'];

/** Warning text by its code. */
export const WARNING_LABELS: Record<WarningCode, string> = {
  AREA_SMALL: 'The area covers only a few grid cells, so the series is noisy.',
  PRELIMINARY_DATA: 'The most recent months use near-real-time data and will be revised.',
  SENSOR_GAP:
    'In a few months the lead sensor had an outage. Those values come from a backup satellite.',
  PARTIAL_COVERAGE: 'Part of the area lies outside the loaded data.',
};

type ErrorCode = components['schemas']['ErrorResponse']['error']['code'];

/** What to tell the user for each API error code: what happened and what to do next. */
export const ERROR_LABELS: Record<ErrorCode, string> = {
  INVALID_GEOMETRY: 'The area has an invalid shape. Redraw it without crossing its own sides.',
  INVALID_REQUEST: 'The request was not accepted. Check the area and the period.',
  AREA_TOO_LARGE: 'The area is larger than the limit. Choose a smaller one.',
  EXPORT_TOO_LARGE: 'The export has too many rows. Shorten the period or reduce the area.',
  NO_DATA: 'The area lies outside the loaded data. Choose an area inside the covered regions.',
  INTERNAL: 'The server could not answer. Try again in a moment.',
};

/** What to tell the user when a request fails before or outside the API. */
export const CLIENT_ERROR_LABELS: Record<ClientErrorCode, string> = {
  NETWORK: 'The server cannot be reached. Check the connection and try again.',
  TIMEOUT:
    'The server is taking too long to answer. Try again, or choose a smaller area or a shorter period.',
  UNKNOWN: 'The server answered in an unexpected way. Try again in a moment.',
  OFFLINE:
    'The server cannot be reached. The saved demo data covers the example areas only and has no hot spot files.',
};

/** English names of example areas by `id`; an unknown `id` falls back to the server text. */
const PRESET_LABELS: Record<string, { name: string; description: string }> = {
  'kz-steppe': {
    name: 'Northern Kazakhstan',
    description: 'Steppe and cropland burning in spring and late summer',
  },
  'amazon-south': {
    name: 'Southern Amazon',
    description: 'Burning season in August and September',
  },
  'california-north': {
    name: 'Northern California',
    description: 'Large wildfires in summer and autumn',
  },
};

/** Name and description of an example area for display. */
export function presetLabel(preset: components['schemas']['Preset']) {
  return PRESET_LABELS[preset.id] ?? { name: preset.name, description: preset.description ?? '' };
}

/** One-letter month names for the calendar header, January first. */
export const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

/** Full month name for a month number 1 to 12. */
export const monthName = (month: number) =>
  monthFormat.format(new Date(Date.UTC(2001, month - 1, 1)));

const shortMonthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** Short month name for a month number 1 to 12: "Nov". */
export const monthShortName = (month: number) =>
  shortMonthFormat.format(new Date(Date.UTC(2001, month - 1, 1)));

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** A number for display: thousands separators, at most one decimal place. */
export const formatNumber = (value: number) => numberFormat.format(value);

/** A signed percentage: "+50 %", "−33 %". The minus is the typographic one. */
export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value))} %`;
}

const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** A short number for tight places: 674, 1.1K, 12K. */
export const formatCompact = (value: number) =>
  compactFormat.format(value >= 100 ? Math.round(value) : value);
