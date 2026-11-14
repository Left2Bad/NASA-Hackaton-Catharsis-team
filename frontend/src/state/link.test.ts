import { afterEach, describe, expect, it } from 'vitest';
import metaJson from '../../../contract/examples/meta.json';
import type { Geometry, Meta } from '../api/types';
import {
  buildSearch,
  calendarHref,
  currentSearch,
  parseSearch,
  writeSearch,
  type LinkState,
} from './link';

const meta = metaJson as unknown as Meta;
const range = { startYear: 2000, endYear: 2026 };
const preset = meta.presets[1];

const box: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [61.5, 51],
      [71, 51],
      [71, 55.25],
      [61.5, 55.25],
      [61.5, 51],
    ],
  ],
};

const defaults: LinkState = { area: null, startYear: 2000, endYear: 2026, mode: 'count' };

afterEach(() => {
  window.location.hash = '';
  writeSearch('');
});

describe('buildSearch (F26)', () => {
  it('is empty for the starting state, so the plain address stays plain', () => {
    expect(buildSearch(defaults, range)).toBe('');
  });

  it('names an example area by its id and leaves the defaults out', () => {
    const area = { geometry: preset.geometry, presetId: preset.id };
    expect(buildSearch({ ...defaults, area }, range)).toBe('?area=amazon-south');
  });

  it('adds the years and the mode only when they differ from the defaults', () => {
    const area = { geometry: preset.geometry, presetId: preset.id };
    expect(buildSearch({ area, startYear: 2010, endYear: 2020, mode: 'anomaly' }, range)).toBe(
      '?area=amazon-south&from=2010&to=2020&mode=anomaly',
    );
    expect(buildSearch({ ...defaults, startYear: 2005 }, range)).toBe('?from=2005');
  });

  it('writes a drawn area as its outline, without the closing point', () => {
    const area = { geometry: box, presetId: null };
    expect(buildSearch({ ...defaults, area }, range)).toBe(
      '?poly=61.5,51;71,51;71,55.25;61.5,55.25',
    );
  });
});

describe('parseSearch (F26)', () => {
  it('gives the starting state for an address without a state', () => {
    expect(parseSearch('', meta, range)).toEqual(defaults);
  });

  it('restores what buildSearch wrote', () => {
    for (const state of [
      { ...defaults, area: { geometry: preset.geometry, presetId: preset.id } },
      { area: { geometry: box, presetId: null }, startYear: 2010, endYear: 2012, mode: 'anomaly' },
      { ...defaults, endYear: 2015 },
    ] satisfies LinkState[]) {
      expect(parseSearch(buildSearch(state, range), meta, range)).toEqual(state);
    }
  });

  it('gives an example area the geometry of the dataset, not one from the address', () => {
    const state = parseSearch('?area=kz-steppe&poly=1,1;2,2;3,1', meta, range);
    expect(state.area?.geometry).toBe(meta.presets[0].geometry);
  });

  it('ignores what it cannot use instead of failing', () => {
    expect(parseSearch('?area=atlantis', meta, range).area).toBeNull();
    expect(parseSearch('?poly=abc', meta, range).area).toBeNull();
    expect(parseSearch('?poly=1,1;2,2', meta, range).area).toBeNull();
    expect(parseSearch('?poly=200,10;201,10;201,11', meta, range).area).toBeNull();
    expect(parseSearch('?mode=rainbow', meta, range).mode).toBe('count');
    expect(parseSearch('?from=soon&to=20x0', meta, range)).toMatchObject({
      startYear: 2000,
      endYear: 2026,
    });
  });

  it('keeps the years inside the record and in order', () => {
    expect(parseSearch('?from=1990&to=2099', meta, range)).toMatchObject({
      startYear: 2000,
      endYear: 2026,
    });
    expect(parseSearch('?from=2020&to=2010', meta, range)).toMatchObject({
      startYear: 2010,
      endYear: 2020,
    });
  });
});

describe('the address of the page', () => {
  it('holds the state after the section and gives it back', () => {
    writeSearch('?area=kz-steppe&from=2010');

    expect(window.location.hash).toBe('#/?area=kz-steppe&from=2010');
    expect(currentSearch()).toBe('?area=kz-steppe&from=2010');
    expect(calendarHref()).toBe('#/?area=kz-steppe&from=2010');
  });

  it('does not touch the address of another section, but remembers the state for the way back', () => {
    window.location.hash = '#/method';

    writeSearch('?area=kz-steppe');

    expect(window.location.hash).toBe('#/method');
    expect(calendarHref()).toBe('#/?area=kz-steppe');
  });

  it('reads no state from a plain address', () => {
    expect(currentSearch()).toBe('');
    window.location.hash = '#/method';
    expect(currentSearch()).toBe('');
  });
});
