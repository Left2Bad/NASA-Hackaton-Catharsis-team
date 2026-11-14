import { useState } from 'react';
import { fetchPointsCsv } from '../api/queries';
import type { Geometry, Meta, PointsResponse } from '../api/types';
import { monthDates, monthFileName, saveBlob } from '../export/files';
import { monthName } from '../labels';
import { spotsSummary } from '../map/spots';
import { ErrorNote } from './ErrorNote';
import styles from './SpotsBar.module.css';

interface SpotsBarProps {
  geometry: Geometry;
  /** `id` of the example area, or `null` for a drawn or typed one. */
  presetId: string | null;
  year: number;
  month: number;
  meta: Meta;
  /** The answer of `POST /points`, once it is there. */
  points: PointsResponse | undefined;
  error: Error | null;
  onRetry: () => void;
  retrying: boolean;
  onHide: () => void;
}

/**
 * The strip above the map while the hot spots of a month are drawn (requirement F13):
 * what is on the map, the same detections as a CSV file, and the way to remove them.
 */
export function SpotsBar({
  geometry,
  presetId,
  year,
  month,
  meta,
  points,
  error,
  onRetry,
  retrying,
  onHide,
}: SpotsBarProps) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);

  /** Every detection of the month as a file: the map may show only a part of them. */
  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      const blob = await fetchPointsCsv({ geometry, ...monthDates(year, month, meta) });
      saveBlob(blob, monthFileName({ geometry, presetId }, year, month));
    } catch (cause) {
      setFailure(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.bar}>
      {error ? (
        <ErrorNote error={error} onRetry={onRetry} retrying={retrying} />
      ) : (
        <div className={styles.text}>
          <p role="status">
            {points
              ? spotsSummary(points, year, month)
              : `Loading the hot spots of ${monthName(month)} ${year}…`}
          </p>
          <p className={styles.hint}>Click a month in the calendar to see its hot spots.</p>
        </div>
      )}
      <div className={styles.actions}>
        {points && points.total > 0 && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            aria-busy={saving}
            // Short on screen, so the strip stays one line high; said in full to a screen reader.
            aria-label={saving ? undefined : 'Download CSV of this month'}
          >
            {saving ? 'Preparing…' : 'Download CSV'}
          </button>
        )}
        <button type="button" onClick={onHide} aria-label="Hide hot spots">
          Hide
        </button>
      </div>
      {failure && <ErrorNote error={failure} />}
    </div>
  );
}
