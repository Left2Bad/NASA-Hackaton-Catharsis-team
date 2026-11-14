import type { PointsResponse } from '../api/types';
import { formatNumber, monthName } from '../labels';

// Words about the hot spots of a month that are drawn on the map (requirement F13).

/** What the strip says about the hot spots that are drawn. */
export function spotsSummary(points: PointsResponse, year: number, month: number): string {
  const when = `${monthName(month)} ${year}`;
  if (points.total === 0) return `No hot spots in ${when}.`;
  // Above the limit the API returns the strongest fires, so the map still covers the whole month.
  const shown = points.truncated
    ? `the ${formatNumber(points.features.length)} strongest of ${formatNumber(points.total)} hot spots`
    : `${formatNumber(points.total)} hot ${points.total === 1 ? 'spot' : 'spots'}`;
  return `${when}: ${shown} on the map, all sensors.`;
}
