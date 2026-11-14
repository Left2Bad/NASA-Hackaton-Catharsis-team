import type { Geometry } from '../api/types';
import { boundsOf, geometryFromRings, outerRings } from '../geo/geometry';

// The map engine: MapLibre GL JS for the map itself and Terra Draw for drawing.
// React talks to it only through the small AreaMapEngine interface below, so the
// component stays free of map-library details and the heavy libraries load lazily.

/** Light vector basemap. OpenFreeMap needs no API key and has no usage fee. */
const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** NASA GIBS Blue Marble imagery, served as public tiles without a key. */
const SATELLITE_TILES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const SATELLITE_LAYER = 'nasa-blue-marble';

/** Used when the basemap style cannot be fetched: a plain surface the user can still draw on. */
const PLAIN_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#eef1f4' } },
  ],
};

const INK = '#16212b';
const WHITE = '#ffffff';
const STYLE_TIMEOUT_MS = 15000;

export type DrawTool = 'select' | 'rectangle' | 'polygon';

export interface AreaMapHandlers {
  /** The user drew, edited or deleted the area. `null` means no area is left. */
  onAreaChange: (geometry: Geometry | null) => void;
  /** A new shape was finished, so the drawing tool has been released. */
  onShapeFinished: () => void;
}

export interface AreaMapEngine {
  /** Switches between drawing a rectangle, drawing a polygon and selecting to edit. */
  setTool: (tool: DrawTool) => void;
  /** Puts an area on the map (or removes it) and optionally moves the view to it. */
  showArea: (geometry: Geometry | null, options: { fit: boolean }) => void;
  /** Shows or hides the satellite imagery under the labels. */
  setSatellite: (visible: boolean) => void;
  destroy: () => void;
}

async function loadBasemapStyle(): Promise<string | typeof PLAIN_STYLE> {
  try {
    const response = await fetch(BASEMAP_STYLE_URL, { method: 'HEAD' });
    return response.ok ? BASEMAP_STYLE_URL : PLAIN_STYLE;
  } catch {
    return PLAIN_STYLE;
  }
}

/**
 * Creates the map inside `container` and resolves once it is ready for drawing.
 * Rejects when the browser cannot render the map (for example, no WebGL).
 */
export async function createAreaMapEngine(
  container: HTMLElement,
  handlers: AreaMapHandlers,
): Promise<AreaMapEngine> {
  const [maplibre, workerUrl, terra, adapterModule, style] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    import('terra-draw'),
    import('terra-draw-maplibre-gl-adapter'),
    loadBasemapStyle(),
  ]);

  // MapLibre looks for its worker next to its own file, which a bundler moves.
  // The `?url` import gives the worker's real address in both dev and production builds.
  maplibre.setWorkerUrl(workerUrl.default);

  const map = new maplibre.Map({
    container,
    style,
    center: [20, 25],
    zoom: 1.3,
    // One copy of the world keeps longitudes inside -180..180, as the API contract requires.
    renderWorldCopies: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    attributionControl: { compact: true },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (map.isStyleLoaded()) resolve();
        else reject(new Error('The map style did not load in time'));
      }, STYLE_TIMEOUT_MS);
      // `style.load` is enough to add layers and does not wait for the first tiles,
      // so the drawing tools appear without delay on a slow connection.
      map.once('style.load', () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  } catch (error) {
    map.remove();
    throw error;
  }

  map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
  map.touchZoomRotate.disableRotation();

  // Satellite imagery sits above the vector basemap but below its labels.
  const firstLabelLayer = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
  map.addSource(SATELLITE_LAYER, {
    type: 'raster',
    tiles: [SATELLITE_TILES],
    tileSize: 256,
    maxzoom: 8,
    attribution: 'Imagery: NASA EOSDIS GIBS, Blue Marble',
  });
  map.addLayer(
    {
      id: SATELLITE_LAYER,
      type: 'raster',
      source: SATELLITE_LAYER,
      layout: { visibility: 'none' },
    },
    firstLabelLayer,
  );

  const shape = {
    fillColor: INK,
    fillOpacity: 0.12,
    outlineColor: INK,
    outlineWidth: 2,
  } as const;
  const handle = { width: 5, outlineWidth: 2 } as const;

  const draw = new terra.TerraDraw({
    adapter: new adapterModule.TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 6 }),
    modes: [
      new terra.TerraDrawSelectMode({
        flags: {
          // A rectangle stays a rectangle: dragging a corner moves the opposite sides with it.
          rectangle: {
            feature: { draggable: true, coordinates: { resizable: 'opposite' } },
          },
          polygon: {
            feature: {
              draggable: true,
              coordinates: { midpoints: true, draggable: true, deletable: true },
            },
          },
        },
        styles: {
          selectedPolygonColor: INK,
          selectedPolygonFillOpacity: 0.16,
          selectedPolygonOutlineColor: INK,
          selectedPolygonOutlineWidth: 2,
          selectionPointColor: WHITE,
          selectionPointOutlineColor: INK,
          selectionPointWidth: handle.width,
          selectionPointOutlineWidth: handle.outlineWidth,
          midPointColor: WHITE,
          midPointOutlineColor: INK,
          midPointWidth: 3,
          midPointOutlineWidth: 1,
        },
      }),
      new terra.TerraDrawRectangleMode({
        drawInteraction: 'click-move-or-drag',
        styles: shape,
      }),
      new terra.TerraDrawPolygonMode({
        // A polygon that crosses itself has no well-defined area, and the API rejects it.
        validation: (feature, { updateType }) =>
          updateType === 'finish' || updateType === 'commit'
            ? terra.ValidateNotSelfIntersecting(feature)
            : { valid: true },
        styles: {
          ...shape,
          closingPointColor: WHITE,
          closingPointOutlineColor: INK,
          closingPointWidth: handle.width,
          closingPointOutlineWidth: handle.outlineWidth,
        },
      }),
    ],
  });
  draw.start();
  draw.setMode('select');

  // True while the engine itself changes features, so those changes are not reported as user edits.
  let internalChange = false;

  const polygons = () =>
    draw.getSnapshot().filter((feature) => feature.geometry.type === 'Polygon');

  const reportArea = () => {
    const rings = polygons().map((feature) => feature.geometry.coordinates[0] as number[][]);
    handlers.onAreaChange(geometryFromRings(rings));
  };

  draw.on('finish', (id, context) => {
    if (context.action === 'draw') {
      // The app works with one area at a time: a new shape replaces the previous one.
      const previous = polygons()
        .map((feature) => feature.id)
        .filter((featureId) => featureId !== undefined && featureId !== id);
      internalChange = true;
      if (previous.length > 0) draw.removeFeatures(previous as (string | number)[]);
      draw.setMode('select');
      draw.selectFeature(id);
      internalChange = false;
      handlers.onShapeFinished();
    }
    reportArea();
  });

  // The Delete key removes the selected shape; that arrives here as a "delete" change.
  draw.on('change', (_ids, type) => {
    if (type === 'delete' && !internalChange && polygons().length === 0) {
      handlers.onAreaChange(null);
    }
  });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return {
    setTool(tool) {
      draw.setMode(tool);
    },

    showArea(geometry, { fit }) {
      internalChange = true;
      draw.setMode('select');
      draw.clear();
      if (geometry) {
        const results = draw.addFeatures(
          outerRings(geometry).map((ring) => ({
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [ring] },
            properties: { mode: 'polygon' },
          })),
        );
        const rejected = results.find((result) => !result.valid);
        if (rejected) console.warn('The area could not be shown on the map:', rejected.reason);

        if (fit) {
          const { west, south, east, north } = boundsOf(geometry);
          map.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            { padding: 64, maxZoom: 8, duration: reducedMotion ? 0 : 700 },
          );
        }
      }
      internalChange = false;
    },

    setSatellite(visible) {
      map.setLayoutProperty(SATELLITE_LAYER, 'visibility', visible ? 'visible' : 'none');
    },

    destroy() {
      draw.stop();
      map.remove();
    },
  };
}
