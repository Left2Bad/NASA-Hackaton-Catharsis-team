import { describe, expect, it } from 'vitest';
import type { MonthValue, SourceInfo } from '../api/types';
import { buildCells, sourceSideLabels, yearsNewestFirst } from './cells';

const month = (year: number, m: number, source: MonthValue['source']): MonthValue => ({
  year,
  month: m,
  value: 10,
  low: 10,
  high: 10,
  median: 10,
  anomaly_pct: 0,
  percentile: 50,
  category: 'normal',
  source,
  preliminary: false,
  partial: false,
});

describe('yearsNewestFirst', () => {
  it('перечисляет годы от свежего к старому без пропусков', () => {
    expect(yearsNewestFirst([month(2010, 5, 'MODIS_TA'), month(2013, 1, 'VIIRS_SNPP')])).toEqual([
      2013, 2012, 2011, 2010,
    ]);
  });

  it('для пустого ряда возвращает пустой список', () => {
    expect(yearsNewestFirst([])).toEqual([]);
  });
});

describe('buildCells', () => {
  const months = [
    month(2011, 2, 'MODIS_TA'),
    month(2012, 1, 'MODIS_TA'),
    month(2012, 2, 'VIIRS_SNPP'),
    month(2012, 3, 'VIIRS_SNPP'),
  ];
  const cell = buildCells(months, () => '#000000');

  it('возвращает undefined для месяца без данных', () => {
    expect(cell(2011, 1)).toBeUndefined();
  });

  it('ставит шов слева, когда источник сменился с прошлого месяца', () => {
    expect(cell(2012, 1)?.seamLeft).toBe(false);
    expect(cell(2012, 2)?.seamLeft).toBe(true);
    expect(cell(2012, 3)?.seamLeft).toBe(false);
  });

  it('ставит шов снизу, когда год назад этот месяц вёл другой источник', () => {
    expect(cell(2012, 2)?.seamBottom).toBe(true);
    expect(cell(2012, 3)?.seamBottom).toBe(false);
  });

  it('передаёт цвет из функции раскраски', () => {
    expect(
      buildCells(months, (m) => (m.year === 2011 ? null : '#123456'))(2011, 2)?.color,
    ).toBeNull();
    expect(cell(2012, 1)?.color).toBe('#000000');
  });
});

describe('sourceSideLabels', () => {
  const sources: SourceInfo[] = [
    { id: 'MODIS_T', label: '', start: '2000-11-01', end: '2002-07-31' },
    { id: 'MODIS_TA', label: '', start: '2002-08-01', end: '2012-01-31' },
    { id: 'VIIRS_SNPP', label: '', start: '2012-02-01', end: '2026-10-31' },
    { id: 'VIIRS_N20', label: '', start: '2026-11-01', end: null },
  ];
  const years = Array.from({ length: 27 }, (_, index) => 2026 - index);

  it('ставит подпись каждого источника напротив середины его периода', () => {
    expect(sourceSideLabels(sources, years)).toEqual([
      { year: 2026, text: 'VIIRS NOAA-20' },
      { year: 2019, text: 'VIIRS Suomi NPP' },
      { year: 2007, text: 'MODIS Terra + Aqua' },
      { year: 2001, text: 'MODIS Terra' },
    ]);
  });

  it('не ставит две подписи на одну строку', () => {
    const labels = sourceSideLabels(sources, [2026, 2025]);
    expect(new Set(labels.map((label) => label.year)).size).toBe(labels.length);
  });
});
