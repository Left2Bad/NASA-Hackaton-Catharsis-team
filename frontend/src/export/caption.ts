import type { CalendarResponse, Meta } from '../api/types';
import { boundsOf, formatBounds } from '../geo/geometry';
import { formatNumber } from '../labels';
import type { ExportScope } from './files';

// The caption printed under every exported image (requirement F24): the area, the period
// and the data source, so the picture explains itself when it travels without the page.

/** The data source line. The wording follows the citation NASA FIRMS asks for. */
export const SOURCE_LINE =
  'Data: NASA FIRMS active fire detections (MODIS and VIIRS), harmonized to the VIIRS Suomi NPP scale.';

/** The three lines of the caption: where, when, and where the data comes from. */
export function captionLines(
  scope: ExportScope,
  areaName: string,
  calendar: Pick<CalendarResponse, 'area_km2' | 'data_through'>,
  meta: Pick<Meta, 'data_version'>,
): string[] {
  const bounds = formatBounds(boundsOf(scope.geometry));
  const years =
    scope.startYear === scope.endYear
      ? String(scope.startYear)
      : `${scope.startYear} to ${scope.endYear}`;
  return [
    `${areaName}: ${bounds}, ${formatNumber(Math.round(calendar.area_km2))} km²`,
    `Period: ${years}. Data through ${calendar.data_through}, version ${meta.data_version}.`,
    SOURCE_LINE,
  ];
}
