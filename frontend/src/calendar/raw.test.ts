import { describe, expect, it } from 'vitest';
import rawJson from '../../../contract/examples/calendar_raw.response.json';
import plainJson from '../../../contract/examples/calendar.response.json';
import type { CalendarResponse, MonthValue } from '../api/types';
import { describeRawMonth, rawLead, rawMonthSentence, rawYearTotals } from './raw';

const raw = rawJson as unknown as CalendarResponse;
const plain = plainJson as unknown as CalendarResponse;
const month = (id: string, calendar = raw): MonthValue => {
  const [year, number] = id.split('-').map(Number);
  const found = calendar.months.find((m) => m.year === year && m.month === number);
  if (!found) throw new Error(`No month ${id} in the example`);
  return found;
};

describe('rawLead', () => {
  it('takes the count of the sensor that leads the month', () => {
    // January 2012 is still led by MODIS, February already by VIIRS.
    expect(rawLead(month('2012-01'))).toBe(1.3);
    expect(rawLead(month('2012-02'))).toBe(5.1);
  });

  it('is null for a response without raw counts', () => {
    expect(rawLead(month('2012-01', plain))).toBeNull();
  });
});

describe('rawYearTotals', () => {
  it('sums what the lead sensors recorded in a year', () => {
    const totals = rawYearTotals(raw.months);
    const expected = raw.months
      .filter((m) => m.year === 2011)
      .reduce((sum, m) => sum + (m.raw?.modis ?? 0), 0);
    expect(totals.get(2011)).toBeCloseTo(expected, 6);
    // Before conversion MODIS shows several times fewer detections than the harmonized record.
    const harmonized = raw.yearly.find((year) => year.year === 2011)?.total ?? 0;
    expect(totals.get(2011)).toBeLessThan(harmonized / 2);
  });

  it('is empty for a response without raw counts', () => {
    expect(rawYearTotals(plain.months).size).toBe(0);
  });
});

describe('describeRawMonth', () => {
  it('puts the recorded count next to the harmonized one and names the factor', () => {
    const description = describeRawMonth(month('2012-01'));

    expect(description.title).toBe('January 2012');
    expect(description.lines.slice(0, 2)).toEqual([
      { label: 'Recorded by MODIS Terra + Aqua', value: '1.3' },
      { label: 'Harmonized record', value: '4.3' },
    ]);
    // VIIRS already flew that month: its count is listed for comparison.
    expect(description.lines).toContainEqual({ label: 'VIIRS Suomi NPP', value: '4.5' });
    expect(description.notes).toContain('Harmonization multiplies this month by 3.3.');
  });

  it('has no factor for the reference sensor', () => {
    const description = describeRawMonth(month('2012-02'));

    expect(description.lines[0]).toEqual({ label: 'Recorded by VIIRS Suomi NPP', value: '5.1' });
    expect(description.notes.join(' ')).not.toMatch(/multiplies/);
  });
});

describe('rawMonthSentence', () => {
  it('reads both numbers out', () => {
    expect(rawMonthSentence(month('2012-01'))).toBe(
      'January 2012: 1.3 detections recorded by MODIS Terra + Aqua, 4.3 in the harmonized record',
    );
  });
});
