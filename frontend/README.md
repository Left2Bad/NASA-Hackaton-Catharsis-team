# frontend/ — zone of developer B

The web app: React, TypeScript, Vite, and a map on MapLibre GL JS. Charts arrive with tasks B6 to B9.

Which contract fields each part of the screen is drawn from: [docs/contract-coverage.md](docs/contract-coverage.md).

## Quick start

You need Node 22 or newer. The version is pinned in `.nvmrc`, and CI reads it from the same file. With nvm: `nvm use`.

```bash
cd frontend
```

```bash
npm install
```

```bash
npm run dev
```

The page opens at http://localhost:5173 and runs on mocks, so the backend does not have to be running.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on mocks from `contract/examples/` |
| `npm run dev:api` | Dev server against the real API at `VITE_API_URL` |
| `npm run build` | Type check and build into `dist/` |
| `npm run lint` | ESLint and the Prettier formatting check |
| `npm run format` | Format with Prettier |
| `npm test` | Vitest tests (the page renders on the same mocks) |
| `npm run gen:api` | TypeScript types from `contract/openapi.yaml` |

CI (`.github/workflows/frontend.yml`) runs `npm ci`, `npm run lint`, `npm test` and `npm run build`.

## How the contract, the types and the mocks fit together

- **Types.** `src/api/schema.d.ts` is generated from `contract/openapi.yaml` by `openapi-typescript`.
  The file is not kept in git: it is created on `npm install`, `npm run dev` and `npm run build`.
  When the contract changes, restart the dev server or run `npm run gen:api`.
- **Client.** `src/api/client.ts` uses `openapi-fetch`: paths, request bodies and responses are checked against those types.
- **Mocks.** `src/mocks/handlers.ts`: Mock Service Worker answers with the files from `contract/examples/`.
  Every path of the contract must have a handler, otherwise the type check fails.
  The numbers in the examples are synthetic and the same for every area.
- **Tests** use the same handlers as the browser.

## Design

- **Tokens:** `src/theme/tokens.css` holds the interface colors, the typeface and sizes. The interface is cool and quiet,
  so the calendar stays the brightest thing on screen. `tokens.test.ts` checks text contrast against WCAG AA.
- **Typeface:** Geologica (Latin and Cyrillic), installed as `@fontsource-variable/geologica`
  and served with the app, without requests to external servers.
- **Calendar scales:** `src/theme/scales.ts`. Detections use one warm hue from light to dark,
  with classes at quantiles. Anomalies use blue and orange with a neutral gray in the middle.
- **Color-vision check:** `src/theme/cvd.ts` simulates protanopia, deuteranopia and tritanopia
  (the model of Machado et al., 2009). `scales.test.ts` checks that for every kind of vision the steps stay
  in order and can be told apart. The page `/#/scales` shows the same thing to the eye.
- **Layout:** on a laptop the map is on the left and the panel on the right, and only the panel scrolls.
  Up to 960 px wide, the map and the panel stack.

## Map

- **Engine:** MapLibre GL JS, with Terra Draw for drawing. Both libraries load as separate files
  only when the map is needed (`src/map/engine.ts`), so the panel opens quickly.
- **Basemaps:** the light vector basemap from OpenFreeMap and NASA GIBS Blue Marble imagery (the "Satellite" button).
  Both work without API keys or fees.
- **Area:** a rectangle or a polygon. A drawn shape can be moved, reshaped by its corners,
  given new points at the middle of its sides, and removed with the Delete key. There is always one area:
  a new shape replaces the previous one.
- **Request:** the shape goes to the API as a GeoJSON `Polygon`. Coordinates are rounded to 4 decimals
  (about 11 m), the ring is closed, and longitude stays within −180 to 180 (`src/geo/geometry.ts`).
- **If the map cannot start** (no WebGL or no network), a plain degree grid with the outline of the area
  takes its place, and the example areas keep working.
- **Limitation:** an area that crosses the 180th meridian is not supported yet.

## Area and period controls

- **Coordinates (F2):** the "Enter coordinates" button opens a form with two ways to set the area:
  four bounds, or a point with a radius in km. A circle is sent as a polygon of 64 points, because
  the API has no circle type. The form is also the keyboard alternative to drawing on the map.
- **Example areas (F3)** come from `GET /meta`; their English names are in `src/labels.ts`.
- **Period (F4):** two lists of years; the whole record is the default. The years go into the
  request as `start_year` and `end_year`.
- **Area size (F5):** the app computes the area on a sphere (`src/geo/shapes.ts`) and compares it
  with `limits.max_area_km2` from `GET /meta`. An area above the limit gets a message and is not
  requested. A small area gets the `AREA_SMALL` warning from the API.
- **Errors** are shown in the app's own words by contract code (`ERROR_LABELS` in `src/labels.ts`).
- **Mocks** honor the period and the size of the area (`src/mocks/tailor.ts`), so these controls can
  be tried without the backend. The fire numbers stay synthetic.

## Environment variables

Vite reads the `.env` file from the repository root (see `.env.example`).

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Address of the real API. Defaults to `http://localhost:8000/api/v1` |
| `VITE_API_MOCKS` | `true` or `false`: force the mocks on or off |

Without `VITE_API_MOCKS`, the mocks are on in `npm run dev` and in tests, and off in `npm run dev:api` and in the build.

## Zone boundaries

This folder has its own `package.json`. Files in `pipeline/`, `backend/` and `contract/` are not edited from this zone
(the contract changes through a separate pull request, see `contract/README.md`).
