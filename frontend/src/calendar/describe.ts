import type { CalendarResponse, MonthValue } from '../api/types';
import {
  CATEGORY_LABELS,
  formatNumber,
  formatSignedPercent,
  monthName,
  SOURCE_LABELS,
} from '../labels';

// Words for one calendar cell: the lines of its tooltip and the sentence a screen reader
// hears. Kept apart from the component so the wording can be tested on its own.

type MonthBaseline = CalendarResponse['monthly_baseline'][number];

export interface TooltipLine {
  label: string;
  value: string;
}

export interface CellDescription {
  title: string;
  lines: TooltipLine[];
  /** Short notes about data quality: preliminary, partial month, sensor outage. */
  notes: string[];
}

/** How the month compares with its median, or why it is not compared. */
function comparison(month: MonthValue): string {
  if (month.partial) return 'Partial month, not compared';
  if (month.anomaly_pct !== null) return `${formatSignedPercent(month.anomaly_pct)} vs. median`;
  // The median is zero, so a percentage has no meaning: say how many detections there were.
  return month.value > 0
    ? `${formatNumber(month.value)} above a median of zero`
    : 'Equal to the median';
}

/** What the tooltip of a month cell says (requirement F9). */
export function describeMonth(month: MonthValue): CellDescription {
  const lines: TooltipLine[] = [{ label: 'Detections', value: formatNumber(month.value) }];

  // The reference sensor is not converted, so its value has no uncertainty range.
  if (month.low !== month.value || month.high !== month.value) {
    lines.push({
      label: 'Likely range',
      value: `${formatNumber(month.low)} to ${formatNumber(month.high)}`,
    });
  }
  if (month.median !== null) {
    lines.push({
      label: `Median for ${monthName(month.month)}`,
      value: formatNumber(month.median),
    });
    lines.push({ label: 'Difference', value: comparison(month) });
  }
  if (month.category !== null) {
    const percentile =
      month.percentile === null ? '' : `, percentile ${formatNumber(month.percentile)}`;
    lines.push({ label: 'Level', value: `${CATEGORY_LABELS[month.category]}${percentile}` });
  }
  lines.push({ label: 'Lead sensor', value: SOURCE_LABELS[month.source] });

  const notes: string[] = [];
  if (month.preliminary) notes.push('Preliminary: near-real-time data, to be revised.');
  if (month.partial) notes.push('The month is not over yet.');
  if (month.sensor_gap) notes.push('Sensor outage: the value comes from a backup satellite.');

  return { title: `${monthName(month.month)} ${month.year}`, lines, notes };
}

/** One sentence for a screen reader, so the value never depends on color alone. */
export function monthSentence(month: MonthValue): string {
  const parts = [
    `${monthName(month.month)} ${month.year}: ${formatNumber(month.value)} detections`,
  ];
  if (month.partial) parts.push('partial month');
  else if (month.anomaly_pct !== null) {
    parts.push(`${formatSignedPercent(month.anomaly_pct)} against the median`);
  }
  if (month.category !== null) parts.push(CATEGORY_LABELS[month.category].toLowerCase());
  if (month.preliminary) parts.push('preliminary');
  if (month.sensor_gap) parts.push('sensor outage');
  return parts.join(', ');
}

/** What the tooltip of a median cell says: the typical value of a calendar month and its spread. */
export function describeBaseline(baseline: MonthBaseline): CellDescription {
  return {
    title: `${monthName(baseline.month)}, typical`,
    lines: [
      { label: 'Median', value: formatNumber(baseline.median) },
      {
        label: 'Usual range',
        value: `${formatNumber(baseline.p10)} to ${formatNumber(baseline.p90)}`,
      },
      { label: 'Highest', value: formatNumber(baseline.max) },
    ],
    notes: [`From ${baseline.n_years} baseline years. The range covers 8 years out of 10.`],
  };
}
