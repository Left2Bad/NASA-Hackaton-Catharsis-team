import type { Geometry } from '../api/types';
import { boundsOf, formatBounds, outerRings } from '../geo/geometry';
import styles from './MapPlaceholder.module.css';

const MERIDIANS = Array.from({ length: 37 }, (_, index) => -180 + index * 10);
const PARALLELS = Array.from({ length: 19 }, (_, index) => -90 + index * 10);

/** The whole world, used when no area is chosen. */
const WORLD = { west: -180, south: -90, east: 180, north: 90 };

/**
 * Stand-in for the map when it cannot start, for example without WebGL or offline.
 * Draws a 10° grid and the outline of the chosen area, so the rest of the app stays usable:
 * example areas still work without the interactive map.
 */
export function MapPlaceholder({ geometry }: { geometry: Geometry | null }) {
  const rings = geometry ? outerRings(geometry) : [];
  const { west, south, east, north } = geometry ? boundsOf(geometry) : WORLD;

  // The area takes about a third of the frame. North is up, so latitude is negated.
  const size = geometry ? Math.max(east - west, north - south, 8) * 3 : 360;
  const viewBox = [(west + east) / 2 - size / 2, -(south + north) / 2 - size / 2, size, size].join(
    ' ',
  );
  const label = geometry
    ? `Selected area: ${formatBounds({ west, south, east, north })}`
    : 'No area selected';

  return (
    <div className={styles.map}>
      <svg
        className={styles.canvas}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={label}
      >
        {MERIDIANS.map((lon) => (
          <line key={`m${lon}`} className={styles.graticule} x1={lon} x2={lon} y1={-90} y2={90} />
        ))}
        {PARALLELS.map((lat) => (
          <line
            key={`p${lat}`}
            className={styles.graticule}
            x1={-180}
            x2={180}
            y1={-lat}
            y2={-lat}
          />
        ))}
        {rings.map((ring, index) => (
          <polygon
            key={index}
            className={styles.area}
            points={ring.map(([lon, lat]) => `${lon},${-lat}`).join(' ')}
          />
        ))}
      </svg>
      <p className={styles.caption}>
        {geometry && (
          <span className={styles.bounds}>{formatBounds({ west, south, east, north })}</span>
        )}
        The interactive map could not load. Example areas still work.
      </p>
    </div>
  );
}
