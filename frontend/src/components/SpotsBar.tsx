import { useState } from 'react';
import { fetchPointsCsv } from '../api/queries';
import type { Geometry, Meta, PointsResponse } from '../api/types';
import { monthDates, saveBlob, spanFileName } from '../export/files';
import { formatNumber } from '../labels';
import {
  frpColors,
  MAX_SPAN_MONTHS,
  monthOf,
  moveSpan,
  spanLabel,
  spotsSummary,
} from '../map/spots';
import { ErrorNote } from './ErrorNote';
import styles from './SpotsBar.module.css';

interface SpotsBarProps {
  geometry: Geometry;
  /** `id` of the example area, or `null` for a drawn or typed one. */
  presetId: string | null;
  /** The months on the map, as month indexes (see `monthIndex`). */
  span: { first: number; last: number };
  /** The first and the last month of the record. */
  record: { min: number; max: number };
  meta: Meta;
  /** The detections of the span, once they are there. */
  points: PointsResponse | undefined;
  /** Class boundaries of fire power, in MW, for the points that are drawn. */
  breaks: readonly number[];
  /** The weakest fire that is drawn, in MW; 0 draws them all. */
  minFrp: number;
  error: Error | null;
  onRetry: () => void;
  retrying: boolean;
  onSpanChange: (span: { first: number; last: number }) => void;
  onMinFrpChange: (minFrp: number) => void;
  onHide: () => void;
}

/** The range of a class in words: "below 5", "5 to 15", "150 and more". */
function classRange(breaks: readonly number[], index: number): string {
  if (index === 0) return `below ${formatNumber(breaks[0])}`;
  if (index === breaks.length) return `${formatNumber(breaks[index - 1])} and more`;
  return `${formatNumber(breaks[index - 1])} to ${formatNumber(breaks[index])}`;
}

/**
 * The strip above the map while hot spots are drawn (requirement F13): what is on the
 * map, which months it covers, how the dots are colored, the same detections as a CSV
 * file, and the way to remove them.
 */
export function SpotsBar({
  geometry,
  presetId,
  span,
  record,
  meta,
  points,
  breaks,
  minFrp,
  error,
  onRetry,
  retrying,
  onSpanChange,
  onMinFrpChange,
  onHide,
}: SpotsBarProps) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const when = spanLabel(span.first, span.last);
  const colors = frpColors(breaks);

  /** Every detection of the span as a file: the map may show only a part of them. */
  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const from = monthOf(span.first);
      const to = monthOf(span.last);
      const blob = await fetchPointsCsv({
        geometry,
        start_date: monthDates(from.year, from.month, meta).start_date,
        end_date: monthDates(to.year, to.month, meta).end_date,
      });
      saveBlob(blob, spanFileName({ geometry, presetId }, span.first, span.last));
    } catch (cause) {
      setFailure(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setSaving(false);
    }
  };

  const move = (end: 'first' | 'last', value: number) =>
    onSpanChange(moveSpan(span, end, value, record));
  /** Moves the whole span by months. On a track of many years a month is a few pixels wide,
      so the buttons do what the pointer cannot do precisely. */
  const shift = (months: number) =>
    onSpanChange({ first: span.first + months, last: span.last + months });

  return (
    <div className={styles.bar}>
      <div className={styles.top}>
        {error ? (
          <ErrorNote error={error} onRetry={onRetry} retrying={retrying} />
        ) : (
          <p role="status">
            {points ? spotsSummary(points, when, minFrp) : `Loading the hot spots of ${when}…`}
          </p>
        )}
        <div className={styles.actions}>
          {points && points.total > 0 && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              aria-busy={saving}
              // Short on screen, so the strip stays compact; said in full to a screen reader.
              aria-label={saving ? undefined : 'Download CSV of these months'}
            >
              {saving ? 'Preparing…' : 'Download CSV'}
            </button>
          )}
          <button type="button" onClick={onHide} aria-label="Hide hot spots">
            Hide
          </button>
        </div>
      </div>

      {/* Two sliders on one track: the first and the last month that are on the map. */}
      <div className={styles.span} role="group" aria-label="Months on the map">
        <button
          type="button"
          className={styles.step}
          aria-label="One month earlier"
          disabled={span.first <= record.min}
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <span className={styles.edge}>{monthOf(record.min).year}</span>
        <div className={styles.track}>
          <input
            type="range"
            aria-label="First month on the map"
            aria-valuetext={spanLabel(span.first, span.first)}
            min={record.min}
            max={record.max}
            step={1}
            value={span.first}
            onChange={(event) => move('first', Number(event.target.value))}
          />
          <input
            type="range"
            aria-label="Last month on the map"
            aria-valuetext={spanLabel(span.last, span.last)}
            min={record.min}
            max={record.max}
            step={1}
            value={span.last}
            onChange={(event) => move('last', Number(event.target.value))}
          />
        </div>
        <span className={styles.edge}>{monthOf(record.max).year}</span>
        <button
          type="button"
          className={styles.step}
          aria-label="One month later"
          disabled={span.last >= record.max}
          onClick={() => shift(1)}
        >
          ›
        </button>
      </div>
      <p className={styles.hint}>
        Drag the ends to show up to {MAX_SPAN_MONTHS} months, step with the arrows, or click a month
        in the calendar.
      </p>

      {points && points.total > 0 && breaks.length > 0 && (
        <div className={styles.power} role="group" aria-label="Fire power of the dots">
          <span className={styles.powerTitle}>Fire power, MW</span>
          {colors.map((color, index) => {
            const from = index === 0 ? 0 : breaks[index - 1];
            return (
              <button
                key={index}
                type="button"
                className={styles.band}
                aria-pressed={minFrp === from}
                // A class and everything stronger: the weakest class shows all the dots.
                onClick={() => onMinFrpChange(from)}
                title={
                  index === 0 ? 'Show all hot spots' : `Show ${formatNumber(from)} MW and more`
                }
              >
                <span
                  className={styles.swatch}
                  style={{ background: color, opacity: from < minFrp ? 0.25 : 1 }}
                />
                {classRange(breaks, index)}
              </button>
            );
          })}
        </div>
      )}

      {failure && <ErrorNote error={failure} />}
    </div>
  );
}
