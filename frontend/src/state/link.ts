import type { Geometry, Meta } from '../api/types';
import type { CalendarMode } from '../components/BurnCalendar';
import { normalizeRing, outerRings } from '../geo/geometry';

// The state of the calendar screen in the page address (requirement F26), so a link
// reopens the same area, period and mode:
//
//   #/?area=kz-steppe&from=2010&to=2020&mode=anomaly      an example area by its id
//   #/?poly=61,51;71,51;71,55;61,55                        any other area by its outline
//
// Values equal to the defaults (the whole record, the detections mode) are left out,
// so the address stays short. The address is input from outside: everything is checked.

/** The modes a link may ask for; anything else opens the detections mode. */
const MODES: readonly CalendarMode[] = ['count', 'anomaly', 'raw'];

export interface LinkArea {
  geometry: Geometry;
  presetId: string | null;
}

export interface LinkState {
  area: LinkArea | null;
  startYear: number;
  endYear: number;
  mode: CalendarMode;
}

/** The part of the address after `?`, as the calendar screen last wrote it. */
let calendarSearch = '';

/** The address of the calendar with its state, for links that lead back to it. */
export const calendarHref = () => `#/${calendarSearch}`;

/** A coordinate in the address: at most 4 decimals, without trailing zeros. */
const coordinate = (value: number) => String(Math.round(value * 10000) / 10000);

/** The outline of a drawn area as text: the outer ring without its closing point. */
function outline(geometry: Geometry): string | null {
  const rings = outerRings(geometry);
  // A link holds one outline. Several shapes cannot be drawn in the app anyway.
  if (rings.length !== 1) return null;
  return rings[0]
    .slice(0, -1)
    .map(([lon, lat]) => `${coordinate(lon)},${coordinate(lat)}`)
    .join(';');
}

function parseOutline(text: string): Geometry | null {
  const points = text.split(';').map((pair) => pair.split(',').map(Number));
  const valid = points.every(
    (point) =>
      point.length === 2 &&
      point.every(Number.isFinite) &&
      Math.abs(point[0]) <= 180 &&
      Math.abs(point[1]) <= 90,
  );
  if (!valid) return null;
  const ring = normalizeRing(points);
  return ring ? { type: 'Polygon', coordinates: [ring] } : null;
}

/** The query string for a state: `?area=…&from=…`, or an empty string for the defaults. */
export function buildSearch(
  state: LinkState,
  range: { startYear: number; endYear: number },
): string {
  const params: string[] = [];
  if (state.area?.presetId) {
    params.push(`area=${encodeURIComponent(state.area.presetId)}`);
  } else if (state.area) {
    const text = outline(state.area.geometry);
    if (text) params.push(`poly=${text}`);
  }
  if (state.startYear !== range.startYear) params.push(`from=${state.startYear}`);
  if (state.endYear !== range.endYear) params.push(`to=${state.endYear}`);
  if (state.mode !== 'count') params.push(`mode=${state.mode}`);
  return params.length > 0 ? `?${params.join('&')}` : '';
}

/** A year from the address, kept inside the record; anything else gives the fallback. */
function year(
  text: string | null,
  fallback: number,
  range: { startYear: number; endYear: number },
) {
  if (text === null || !/^\d{4}$/.test(text)) return fallback;
  return Math.min(range.endYear, Math.max(range.startYear, Number(text)));
}

/**
 * The state an address asks for. Whatever is missing or wrong falls back to the default:
 * a broken link opens the app in its starting state instead of failing.
 */
export function parseSearch(
  search: string,
  meta: Pick<Meta, 'presets'>,
  range: { startYear: number; endYear: number },
): LinkState {
  const params = new URLSearchParams(search);

  let area: LinkArea | null = null;
  const preset = meta.presets.find((item) => item.id === params.get('area'));
  if (preset) {
    area = { geometry: preset.geometry, presetId: preset.id };
  } else if (params.has('poly')) {
    const geometry = parseOutline(params.get('poly') ?? '');
    if (geometry) area = { geometry, presetId: null };
  }

  const startYear = year(params.get('from'), range.startYear, range);
  const endYear = year(params.get('to'), range.endYear, range);
  return {
    area,
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
    mode: MODES.find((mode) => mode === params.get('mode')) ?? 'count',
  };
}

/** The query part of the current address: `?area=…` from `#/?area=…`. */
export function currentSearch(): string {
  const hash = window.location.hash;
  const start = hash.indexOf('?');
  return start === -1 ? '' : hash.slice(start);
}

/**
 * Writes the state into the address without adding a step to the browser history:
 * otherwise "Back" would walk through every change of the period.
 */
export function writeSearch(search: string): void {
  calendarSearch = search;
  // The reader may already have moved to another section: its address is not ours to change.
  const section = window.location.hash.replace(/^#/, '').split('?')[0];
  if (section !== '' && section !== '/') return;
  const target = `#/${search}`;
  if (window.location.hash === target || (search === '' && window.location.hash === '')) return;
  window.history.replaceState(null, '', target);
}
