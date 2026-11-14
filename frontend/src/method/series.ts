import type { components } from '../api/schema';
import type { CalendarResponse } from '../api/types';
import { monthName, presetLabel } from '../labels';

// Series and labels of the "Method" page (requirement F25): what harmonization changes,
// and how well it predicts VIIRS on years it was not fitted on.

type Schemas = components['schemas'];
export type ValidationResponse = Schemas['ValidationResponse'];
export type ValidationRegion = Schemas['ValidationRegion'];
export type SeamTest = Schemas['SeamTest'];

/** One year of the "before and after" chart. `null`: the sensor has no whole year here. */
export interface YearOfSensors {
  year: number;
  modis: number | null;
  viirs: number | null;
  harmonized: number;
}

/**
 * Yearly sums of the raw sensor counts next to the harmonized record, from a calendar
 * requested with `series=raw`. Only complete years, and a sensor counts for a year only
 * when it has all twelve months: a partial year would look like a drop.
 */
export function yearlySensors(calendar: CalendarResponse): YearOfSensors[] {
  return calendar.yearly
    .filter((year) => year.complete)
    .map((year) => {
      const months = calendar.months.filter((month) => month.year === year.year);
      const sum = (pick: (raw: NonNullable<(typeof months)[number]['raw']>) => number | null) => {
        const values = months.map((month) => (month.raw ? pick(month.raw) : null));
        if (values.length < 12 || values.some((value) => value === null)) return null;
        return values.reduce<number>((total, value) => total + (value ?? 0), 0);
      };
      return {
        year: year.year,
        modis: sum((raw) => raw.modis),
        viirs: sum((raw) => raw.viirs_snpp),
        harmonized: year.total,
      };
    });
}

/** The months of a validation series as chart positions: "August 2021". */
export const validationPositions = (region: ValidationRegion): string[] =>
  region.series.map((point) => `${monthName(point.month)} ${point.year}`);

/** Chart ticks of a validation series: every January, labeled with its year. */
export const validationTicks = (region: ValidationRegion): { index: number; label: string }[] =>
  region.series.flatMap((point, index) =>
    point.month === 1 ? [{ index, label: String(point.year) }] : [],
  );

/** The app's own names for the seam tests; an unknown `id` falls back to the server text. */
const SEAM_LABELS: Record<SeamTest['id'], string> = {
  modis_to_snpp_2012: 'MODIS to Suomi NPP, 2012: the three years after against the three before',
  snpp_to_n20_2026: 'Suomi NPP to NOAA-20, 2026: checked on 2024 and 2025',
};

export const seamLabel = (seam: SeamTest): string => SEAM_LABELS[seam.id] ?? seam.label;

/** The name of a validation region: regions share their `id` with the example areas. */
export const regionName = (region: ValidationRegion): string =>
  presetLabel({ id: region.id, name: region.name, geometry: { type: 'Polygon', coordinates: [] } })
    .name;
