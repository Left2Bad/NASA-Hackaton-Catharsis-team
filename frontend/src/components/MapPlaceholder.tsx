import type { Geometry } from '../api/types';
import styles from './MapPlaceholder.module.css';

type Ring = readonly (readonly [number, number])[];

/** Все внешние кольца геометрии: у полигона одно, у мультиполигона — по одному на часть. */
function outerRings(geometry: Geometry): Ring[] {
  return geometry.type === 'Polygon'
    ? [geometry.coordinates[0]]
    : geometry.coordinates.map((polygon) => polygon[0]);
}

const formatLon = (lon: number) => `${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`;
const formatLat = (lat: number) => `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}`;

const MERIDIANS = Array.from({ length: 37 }, (_, index) => -180 + index * 10);
const PARALLELS = Array.from({ length: 19 }, (_, index) => -90 + index * 10);

/**
 * Заглушка карты для макета: градусная сетка и контур выбранной области.
 * Настоящую карту MapLibre с рисованием области добавит задача B4.
 */
export function MapPlaceholder({ geometry }: { geometry: Geometry }) {
  const rings = outerRings(geometry);
  const lons = rings.flatMap((ring) => ring.map(([lon]) => lon));
  const lats = rings.flatMap((ring) => ring.map(([, lat]) => lat));
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  // Область занимает около трети кадра; на карте север вверху, поэтому широта со знаком минус.
  const size = Math.max(east - west, north - south, 8) * 3;
  const viewBox = [(west + east) / 2 - size / 2, -(south + north) / 2 - size / 2, size, size].join(
    ' ',
  );

  return (
    <div className={styles.map}>
      <svg
        className={styles.canvas}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={`Selected area: ${formatLon(west)} to ${formatLon(east)}, ${formatLat(south)} to ${formatLat(north)}`}
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
        <span className={styles.bounds}>
          {formatLon(west)} to {formatLon(east)}, {formatLat(south)} to {formatLat(north)}
        </span>
        Placeholder: the interactive map with drawing tools arrives with task B4.
      </p>
    </div>
  );
}
