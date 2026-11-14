import { useMemo } from 'react';
import type { CalendarResponse, SourceInfo } from '../api/types';
import { buildCells, sourceSideLabels, yearsNewestFirst } from '../calendar/cells';
import { formatNumber } from '../labels';
import { COUNT_RAMP, countColor, quantileBreaks, ZERO_COLOR } from '../theme/scales';
import styles from './CalendarPreview.module.css';
import { HeatGrid } from './HeatGrid';
import { ScaleLegend } from './ScaleLegend';

interface CalendarPreviewProps {
  calendar: CalendarResponse;
  sources: readonly SourceInfo[];
}

/**
 * Календарь горения в виде для макета (задача B3): сетка, шкала количества и швы
 * между сенсорами. Подсказки, итоги по годам, медианы и режим аномалий — задачи B6 и B7.
 */
export function CalendarPreview({ calendar, sources }: CalendarPreviewProps) {
  const { months } = calendar;

  const years = useMemo(() => yearsNewestFirst(months), [months]);
  // Неполный текущий месяц не участвует в расчёте границ: он занижен по определению.
  const breaks = useMemo(
    () => quantileBreaks(months.filter((m) => !m.partial).map((m) => m.value)),
    [months],
  );
  const cell = useMemo(
    () => buildCells(months, (month) => countColor(month.value, breaks)),
    [months, breaks],
  );
  const sideLabels = useMemo(() => sourceSideLabels(sources, years), [sources, years]);

  if (years.length === 0) return null;

  return (
    <div className={styles.calendar}>
      <ScaleLegend
        title="Fire detections per month, VIIRS-equivalent"
        colors={COUNT_RAMP}
        boundaries={breaks.map(formatNumber)}
        ends={['fewer', 'more']}
        extras={[
          { color: ZERO_COLOR, label: 'No fires' },
          { color: null, label: 'No data' },
        ]}
      />
      <HeatGrid
        years={years}
        cell={cell}
        sideLabels={sideLabels}
        label={`Fire detections by month, ${years[years.length - 1]} to ${years[0]}. Darker cells mean more detections.`}
      />
      <p className={styles.caption}>
        Dark lines are the seams of the record: the lead sensor changes there. Colors run across
        them without a jump because every sensor is converted to the same VIIRS scale.
      </p>
    </div>
  );
}
