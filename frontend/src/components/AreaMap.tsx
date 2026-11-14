import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Geometry } from '../api/types';
import { boundsOf, formatBounds } from '../geo/geometry';
import { createAreaMapEngine, type AreaMapEngine, type DrawTool } from '../map/engine';
import styles from './AreaMap.module.css';
import { MapPlaceholder } from './MapPlaceholder';

interface AreaMapProps {
  /** The current area of interest, or `null` when none is chosen. */
  geometry: Geometry | null;
  /** Called when the user draws, edits or clears the area on the map. */
  onChange: (geometry: Geometry | null) => void;
}

type Status = 'loading' | 'ready' | 'failed';

const TOOLS: readonly { tool: DrawTool; label: string }[] = [
  { tool: 'rectangle', label: 'Rectangle' },
  { tool: 'polygon', label: 'Polygon' },
];

function hintFor(status: Status, tool: DrawTool, geometry: Geometry | null): string {
  if (status === 'loading') return 'Loading the map…';
  if (tool === 'rectangle') return 'Click one corner, then click the opposite corner.';
  if (tool === 'polygon') return 'Click to add corners. Click the first corner again to finish.';
  if (geometry) return 'Click the shape to move it or drag its corners.';
  return 'Draw an area with the tools above, or pick an example.';
}

/**
 * World map where the user draws the area of interest as a rectangle or a polygon,
 * adjusts it and clears it (requirement F1). The drawn shape is reported upward as
 * GeoJSON and goes straight into API requests.
 */
export function AreaMap({ geometry, onChange }: AreaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<AreaMapEngine | null>(null);
  // The geometry currently drawn on the map. Lets the component tell an area chosen
  // elsewhere (an example) from one that the map itself has just reported.
  const shownRef = useRef<Geometry | null>(null);
  const onChangeRef = useRef(onChange);

  const [status, setStatus] = useState<Status>('loading');
  const [tool, setTool] = useState<DrawTool>('select');
  const [satellite, setSatellite] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let engine: AreaMapEngine | null = null;

    createAreaMapEngine(container, {
      onAreaChange: (next) => {
        shownRef.current = next;
        onChangeRef.current(next);
      },
      onShapeFinished: () => setTool('select'),
    })
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        engine = created;
        engineRef.current = created;
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn('The map could not start:', error);
        setStatus('failed');
      });

    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
      shownRef.current = null;
    };
  }, []);

  // Show an area that was chosen outside the map, and move the view to it.
  useEffect(() => {
    if (status !== 'ready' || geometry === shownRef.current) return;
    engineRef.current?.showArea(geometry, { fit: true });
    shownRef.current = geometry;
  }, [geometry, status]);

  const chooseTool = (next: DrawTool) => {
    const value = tool === next ? 'select' : next;
    setTool(value);
    engineRef.current?.setTool(value);
  };

  const clearArea = () => {
    engineRef.current?.showArea(null, { fit: false });
    shownRef.current = null;
    setTool('select');
    onChange(null);
  };

  const toggleSatellite = () => {
    engineRef.current?.setSatellite(!satellite);
    setSatellite(!satellite);
  };

  if (status === 'failed') {
    return <MapPlaceholder geometry={geometry} />;
  }

  return (
    <div className={styles.wrap}>
      <div
        ref={containerRef}
        className={styles.map}
        role="application"
        aria-label="Map for choosing the area of interest"
      />

      {status === 'ready' && (
        <div className={styles.toolbar} role="toolbar" aria-label="Map tools">
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              aria-pressed={tool === item.tool}
              onClick={() => chooseTool(item.tool)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" onClick={clearArea} disabled={geometry === null}>
            Clear
          </button>
          <span className={styles.divider} aria-hidden="true" />
          <button type="button" aria-pressed={satellite} onClick={toggleSatellite}>
            Satellite
          </button>
        </div>
      )}

      {/* With an area chosen and no tool active the hint only repeats the panel header,
          so narrow screens hide it to keep the map visible. */}
      <p
        className={
          geometry && tool === 'select' ? `${styles.hint} ${styles.hintQuiet}` : styles.hint
        }
        aria-live="polite"
      >
        {geometry && tool === 'select' && (
          <span className={styles.bounds}>{formatBounds(boundsOf(geometry))}</span>
        )}
        {hintFor(status, tool, geometry)}
      </p>
    </div>
  );
}
