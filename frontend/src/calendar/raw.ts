import type { MonthValue } from '../api/types';
import { formatNumber, monthName, SOURCE_LABELS } from '../labels';
import type { CellDescription, TooltipLine } from './describe';

// The "original sensors" view of the calendar (requirement F19): every month shows what
// its lead sensor recorded, without conversion to the common scale. Put next to the
// harmonized record it shows what harmonization changes: the jump where VIIRS takes over.

type RawValues = NonNullable<MonthValue['raw']>;

/** Which raw count belongs to the sensor that leads the month. */
const LEAD_FIELD: Record<MonthValue['source'], keyof RawValues> = {
  MODIS_T: 'modis',
  MODIS_TA: 'modis',
  VIIRS_SNPP: 'viirs_snpp',
  VIIRS_N20: 'viirs_n20',
};

const RAW_LABELS: Record<keyof RawValues, string> = {
  modis: 'MODIS',
  viirs_snpp: 'VIIRS Suomi NPP',
  viirs_n20: 'VIIRS NOAA-20',
};

/**
 * What the lead sensor of the month recorded, as it is. `null` when the response has no
 * raw counts (it was not asked with `series=raw`) or the sensor has none for the month.
 */
export function rawLead(month: MonthValue): number | null {
  return month.raw?.[LEAD_FIELD[month.source]] ?? null;
}

/** Yearly sums of the lead sensors as recorded; a year without any raw count is left out. */
export function rawYearTotals(months: readonly MonthValue[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const month of months) {
    const value = rawLead(month);
    if (value !== null) totals.set(month.year, (totals.get(month.year) ?? 0) + value);
  }
  return totals;
}

/** What the tooltip of a month says in the "original sensors" view. */
export function describeRawMonth(month: MonthValue): CellDescription {
  const lead = rawLead(month);
  const lines: TooltipLine[] = [
    {
      label: `Recorded by ${SOURCE_LABELS[month.source]}`,
      value: lead === null ? 'no data' : formatNumber(lead),
    },
    { label: 'Harmonized record', value: formatNumber(month.value) },
  ];
  // The other sensors that flew that month, for comparison.
  const leadField = LEAD_FIELD[month.source];
  for (const field of Object.keys(RAW_LABELS) as (keyof RawValues)[]) {
    const value = month.raw?.[field];
    if (field !== leadField && value !== null && value !== undefined) {
      lines.push({ label: RAW_LABELS[field], value: formatNumber(value) });
    }
  }

  const notes: string[] = [];
  if (lead !== null && lead > 0 && month.value !== lead) {
    notes.push(
      `Harmonization multiplies this month by ${formatNumber(Math.round((month.value / lead) * 10) / 10)}.`,
    );
  }
  if (month.preliminary) notes.push('Preliminary: near-real-time data, to be revised.');
  if (month.partial) notes.push('The month is not over yet.');

  return { title: `${monthName(month.month)} ${month.year}`, lines, notes };
}

/** One sentence for a screen reader in the "original sensors" view. */
export function rawMonthSentence(month: MonthValue): string {
  const lead = rawLead(month);
  const recorded =
    lead === null
      ? 'no raw count'
      : `${formatNumber(lead)} detections recorded by ${SOURCE_LABELS[month.source]}`;
  return `${monthName(month.month)} ${month.year}: ${recorded}, ${formatNumber(month.value)} in the harmonized record`;
}
