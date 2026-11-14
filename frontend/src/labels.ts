import type { components } from './api/schema';

// Подписи интерфейса для идентификаторов из контракта. Тексты сервера приходят на одном
// языке, поэтому названия источников и единиц фронтенд держит у себя (см. contract/README.md).
// Второй язык появится здесь же в задаче B14.

type SourceId = components['schemas']['Source'];

/** Короткое название ведущего источника единого ряда. */
export const SOURCE_LABELS: Record<SourceId, string> = {
  MODIS_T: 'MODIS Terra',
  MODIS_TA: 'MODIS Terra + Aqua',
  VIIRS_SNPP: 'VIIRS Suomi NPP',
  VIIRS_N20: 'VIIRS NOAA-20',
};

type WarningCode = components['schemas']['Warning']['code'];

/** Текст предупреждения по его коду. */
export const WARNING_LABELS: Record<WarningCode, string> = {
  AREA_SMALL: 'The area covers only a few grid cells, so the series is noisy.',
  PRELIMINARY_DATA: 'The most recent months use near-real-time data and will be revised.',
  SENSOR_GAP:
    'In a few months the lead sensor had an outage. Those values come from a backup satellite.',
  PARTIAL_COVERAGE: 'Part of the area lies outside the loaded data.',
};

/** Английские названия областей-примеров по их `id`; для незнакомого `id` берётся текст сервера. */
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

/** Название и описание области-примера для показа. */
export function presetLabel(preset: components['schemas']['Preset']) {
  return PRESET_LABELS[preset.id] ?? { name: preset.name, description: preset.description ?? '' };
}

/** Однобуквенные названия месяцев для шапки календаря, январь — первый. */
export const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

/** Полное название месяца по номеру 1–12. */
export const monthName = (month: number) =>
  monthFormat.format(new Date(Date.UTC(2001, month - 1, 1)));

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Число для показа: разделители тысяч, не больше одного знака после запятой. */
export const formatNumber = (value: number) => numberFormat.format(value);

/** Процент со знаком: «+50 %», «−33 %». Минус — типографский. */
export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value))} %`;
}
