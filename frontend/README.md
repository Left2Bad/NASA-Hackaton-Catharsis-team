# frontend/ — zone of developer B

The web app: React, TypeScript, Vite, and a map on MapLibre GL JS. Charts are drawn as plain SVG, without a chart library.

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
| `npm run e2e` | End-to-end tests in a real browser (Playwright), see below |
| `npm run gen:api` | TypeScript types from `contract/openapi.yaml` |
| `npm run snapshot` | Save answers of the running API into `public/snapshot/` for the fallback mode |
| `npm run demo:shots` | Take the frames of the demo from the running app into `docs/demo/screenshots/` |
| `npm run demo:slides` | Print the pitch deck `docs/demo/slides/slides.html` into a PDF |

CI (`.github/workflows/frontend.yml`) runs `npm ci`, `npm run lint`, `npm test`, `npm run build` and `npm run e2e`.

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
- **Phone from 360 px:** the header wraps its sections under the name, charts are measured before the
  first paint and can never be wider than their box, and long addresses on the "Method" page break
  inside words. Nothing makes the page scroll sideways.

## How the panel reads

The panel answers the questions of the challenge in the order a reader asks them, and says what its
numbers are, so a specialist can check them.

- **The answer first:** one line under the name of the area gives the current month: its level, the
  count and the difference from the median of the same days (`nowHeadline` in `src/now/describe.ts`).
  The "Now" section further down has the numbers behind it.
- **The calendar next:** it is the subject of the challenge, so it stays on the first screen.
- **Jump links:** "Calendar, Summary, Now, Season, Years, Days, Downloads" stay at the top of the panel
  while it scrolls (`src/components/SectionNav.tsx`). On a phone they are one row that scrolls sideways.
- **What is counted:** a closed note under the header names the unit (VIIRS Suomi NPP equivalents), why
  values can be fractional, what is left out (low confidence, static sources) and the baseline years.
- **Terms are kept and explained:** "median", "percentile" and "baseline" stay, because the reader may
  need to cite them. Next to them stand the words that make them usable: "above 84 % of those years",
  "25 baseline years", and a sentence that ties the five levels to P25, P75, P90 and the maximum.
- **Whole numbers from 100 up:** "16,430 detections", not "16,430.3" (`formatNumber` in `src/labels.ts`).
  Below 100 one decimal stays, because converted MODIS counts of a small area are fractional.
- **The start screen** says how to begin in three steps, and the area buttons are marked as examples.
- **One error, not two:** when the calendar cannot be loaded, the "Now" section does not repeat the
  same message.

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

## Burn calendar

- **Grid (F7):** a row per year, newest first, and a column per month (`src/components/BurnCalendar.tsx`).
  Color is the detections scale with classes at quantiles (F11, F12).
- **Totals and medians (F8):** the yearly total is on the right, gray for incomplete years.
  The bottom row shows the long-term median of each calendar month.
- **Tooltip (F9):** hovering or focusing a cell shows the exact value, the likely range, the median,
  the difference, the level, the lead sensor, and notes for preliminary data, a partial month
  or a sensor outage. The wording lives in `src/calendar/describe.ts`.
- **Modes (F10):** the switch above the legend recolors the same data. "Detections" shows how much
  burned; "Anomaly" shows the difference from the median of the same calendar month, blue below
  and orange above. A month that cannot be compared (a partial month, or a zero median) is hatched.
  Switching needs no new request.
- **Keyboard:** Tab reaches one cell, arrow keys move between cells, Home and End jump to the ends
  of a row, Escape closes the tooltip.
- **Not color alone:** every cell has a spoken description with its numbers, preliminary months
  carry a corner mark, and seams between sensors are drawn as lines.

## "Now" panel and summary

- **Request (F15):** `POST /current` carries only the `geometry`. The period of the calendar does not
  apply to "now", so changing the years does not ask for it again. An area above the size limit is not
  requested. If the request fails, the error stays inside the "Now" section and the calendar remains.
- **Answer first:** the panel leads with the level in words ("Above normal") and the difference from
  the median of the same days, then the numbers behind them: detections so far, the median, the percentile.
- **Level strip:** five levels on one scale, built from `baseline_same_days` (`p25`, `p75`, `p90`, `max`),
  with a mark at the current value. The list under it names every level with its range, and the
  current one is bold, so the level never depends on color alone. Colors are steps of the anomaly scale.
- **Cumulative chart** (`src/components/CumulativeChart.tsx`): detections since the start of the month
  against the median of the same days. The time axis covers the whole month. The readout above the plot
  shows the latest day, the day under the pointer, or the day chosen with the arrow keys (Home and End
  jump to the ends). The median line is dashed as well as gray. A hidden table holds the same numbers
  for screen readers.
- **Summary (F16):** four facts from `calendar.summary` (`src/calendar/summary.ts`): the most active
  year with its total, the peak month with its median, the detections of the period, and the trend as
  a word with an arrow ("Rising", "Falling", "No change"). A missing trend says "too few complete years".
  An area without fires gets dashes and a sentence that says so.
- **Wording** of the panel lives in `src/now/describe.ts`, the chart geometry in `src/now/chart.ts`.

## Season profile and yearly totals

- **Season profile (F17)** (`src/components/SeasonProfile.tsx`): the median of every calendar month
  as a dashed line, the 10th to 90th percentile as a gray band, and one chosen year as a solid line
  over them. The year is picked from a list in the caption; the newest year is the default. A month
  that is not over yet is drawn as a ring instead of a dot.
- **Yearly totals (F18)** (`src/components/YearlyTotals.tsx`): a bar per year and the trend line from
  `calendar.summary.trend_line`. Incomplete years (the first and the current one) are hatched and
  take no part in the trend. With too few complete years there is no line, and a note says why.
- **No new request:** both charts are cut from the calendar response that is already loaded
  (`src/calendar/series.ts`), so they follow the chosen period and choosing a year is instant.
- **Reading a value:** every chart has a readout above the plot. It shows one position by default
  (the busiest month of the year, the latest complete year), the one under the pointer on hover,
  and the one chosen with the arrow keys on focus (Home and End jump to the ends). A hidden table
  holds the same numbers for screen readers.
- **Shared parts:** `src/charts/scale.ts` (round value axis, tick format, line path),
  `src/charts/useCursor.ts` (pointer and keyboard position) and `src/components/Chart.module.css`
  are used by all three charts, including the one in the "Now" panel.

## Original sensors, hot spots and the daily calendar

Three views that go deeper than the monthly calendar (requirements F19, F13 and F14).

- **Original sensors (F19):** the third button of the calendar mode switch. Every month shows what its
  lead sensor recorded, without conversion: MODIS before February 2012, VIIRS after. The colors keep
  the classes of the harmonized record, so the step at the seam is the difference between the sensors
  and not a change in fire activity. The tooltip puts the recorded count next to the harmonized one
  and names the factor between them; the yearly totals are sums of the recorded counts
  (`src/calendar/raw.ts`). The raw counts are asked only for this view: the request gets `series=raw`.
- **Hot spots of a month (F13):** a click on a month (or Enter on a focused cell) asks `POST /points`
  for that month and draws the detections as dots on the map, under the outline of the area. A strip
  above the map says how many are drawn; above `limits.max_points` the API returns the strongest
  fires by radiative power and the strip says so. A second click, the "Hide hot spots" button or a
  change of area removes the dots. The dots are a MapLibre circle layer below the place names
  (`showPoints` in `src/map/engine.ts`).
- **Daily calendar (F14):** the section under the yearly totals. A row per month and a column per day
  of the chosen year, from `POST /daily`. The classes are quantiles of that year alone. The readout
  above the grid names the busiest day, the day under the pointer, or the day reached with the arrow
  keys (left and right step through the year, up and down go to the same day of the neighboring
  month, Home and End to the ends of the month). Helpers are in `src/calendar/daily.ts`.

## Link with the state

The address of the page describes what is on the calendar screen (requirement F26,
`src/state/link.ts`), so a copied link reopens the same view:

```text
/#/?area=kz-steppe&from=2010&to=2020&mode=anomaly     an example area by its id (mode: anomaly or raw)
/#/?poly=61,51;71,51;71,55;61,55                      any other area by its outline
```

- Values equal to the defaults (the whole record, the detections mode) are left out.
- The address is rewritten in place on every change: "Back" does not walk through each period.
- The "Calendar" link in the header keeps the state, so a visit to "Method" does not lose it.
- A broken link opens the starting screen: every part of the address is checked, years are kept
  inside the record, and an example area takes its geometry from the dataset, not from the link.
- "Copy link to this view" under the name of the area copies the address.

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

## "Method" page

The page at `/#/method` (`src/screens/MethodPage.tsx`, requirement F25).

- **What harmonization changes:** yearly sums of the sensors as they recorded next to the harmonized
  record, for an example area chosen from a list. The data is `POST /calendar` with `series=raw`
  (`yearlySensors` in `src/method/series.ts`); a sensor is drawn for a year only when it has all
  twelve months.
- **How it was checked:** from `GET /method/validation`. For every region: correlation, bias, median
  monthly error, months compared, and a chart of the forecast from MODIS against what VIIRS really
  recorded on the test years. Then the table of the seams: the ratio after and before the seam in the
  harmonized record and with a naive splice.
- **Which sensor leads the record:** `meta.sources`.
- **Limitations:** `validation.limitations`, the server text as it is.
- **The method in detail:** `docs/methodology.md`, written by the developer of the method, is shown
  as it is (`src/method/markdown.ts`, the `marked` library). The page and the document cannot drift
  apart: the document is the single source. Only the note for the team above the first section is
  left out. The HTML is trusted because the file belongs to this repository.
- **Acknowledgment** of NASA FIRMS with the data products that are used.
- **Loaded on demand:** the page, the method text and the Markdown renderer are a separate chunk, so
  the calendar starts without them.
- **Charts** use the shared `LineChart` component: several series over the same positions, gaps
  where a sensor has no data, and three colors checked for color-vision deficiency.

## Downloads

The "Downloads" section of the panel (`src/components/Downloads.tsx`, helpers in `src/export/`).

- **Monthly table, CSV (F23):** `POST /export/calendar.csv` for the area and the chosen years.
- **Hot spots, CSV (F22):** `POST /export/points.csv`. The years of the period become dates, January 1
  to December 31, cut to the record of the dataset (`exportDates`). Two date fields under the buttons
  set any other range, so a single month of a large area fits under the row limit; the file is then
  named after the dates. The strip above the map offers the same file for the month whose hot spots
  are drawn ("Download this month (CSV)"). Every row has its sensor and its
  weight in the harmonized record. Above `limits.max_export_rows` the server answers `EXPORT_TOO_LARGE`
  and the app says to shorten the period; when the calendar total already exceeds the limit, the
  note under the buttons warns before the click.
- **Images, PNG (F24):** the calendar (in the mode that is on screen), the season profile (with the
  chosen year), the yearly totals and the current month. Every image has a title, a legend and a
  caption: the area with its bounds and size, the period with the data date and version, and the
  data source. The current-month image names the days it covers and how they compare instead of
  the years, and appears in the list once the "Now" request has answered.
- **How an image is made:** the charts are SVG already, so a copy with its styles written inline
  (`chartSvg.ts`) is painted on a canvas. The calendar is an HTML grid on the page, so the export
  redraws it as SVG from the same data and colors (`calendarSvg.ts`). `png.ts` adds the title, the
  legend and the caption and saves at double resolution. No library is involved.
- **Fonts:** images use Geologica, like the page. The canvas takes the font from the page; an SVG
  painted as an image is a separate document, so the Latin subset of the font (25 KB) is put inside
  it as a data URI (`font.ts`). If the font cannot be loaded, the image falls back to the system font.
- **File names** say what, where and when, and carry the data source:
  `firms-hotspots_kz-steppe_2010-2012.csv`, `firms-calendar_61E-71E_51N-55N_2025.png`.
- **Data source in a CSV:** a comment line at the top would break opening the file in a spreadsheet,
  so NASA FIRMS is named in the file name and in the text next to the buttons.

## Connecting to the real API

1. Start the backend (see `backend/README.md`). It needs the data files in `data/` and, for a browser
   on another port, `CORS_ORIGINS=http://localhost:5173`.
2. Run `npm run dev:api`. The app reads `VITE_API_URL` from the `.env` file in the repository root;
   without it the address is `http://localhost:8000/api/v1`. The build (`npm run build`) uses the same
   variable and never includes the mocks.

How the app behaves while it talks to a server (`src/api/request.ts`, `src/api/queryClient.ts`):

- **Loading:** a note with a spinner. After 4 seconds the calendar note adds that large areas take
  longer. When only the period changes, the previous calendar stays in place, dimmed, until the new
  one arrives; for another area nothing is kept, so numbers never appear under the wrong name.
- **No fires:** an area without detections is a normal answer, not an error. A message stands in
  for the calendar and the charts, and the "Now" panel says there are no levels to compare with.
- **Errors:** every failure is said in the app's own words (`ERROR_LABELS`, `CLIENT_ERROR_LABELS` in
  `src/labels.ts`). Besides the codes of the contract there are three of the client: `NETWORK` (the
  server cannot be reached), `TIMEOUT` (no answer in 30 seconds) and `UNKNOWN` (an answer that is not
  in the contract format, for example a proxy page).
- **Trying again:** a network or server fault is retried once silently. After that the error shows a
  "Try again" button. Requests the server refused (area too large, invalid shape, no data) get no
  button, because the answer would be the same. A timeout is not retried silently.
- **Cancelling:** a request whose answer is no longer needed (the user chose another area) is
  cancelled, so the server is not kept busy.
- **Older browsers:** requests combine their cancel and timeout signals with `AbortSignal.any`, which
  browsers got only in 2023 and 2024 (Chrome 116, Safari 17.4, Firefox 124). Where it is missing the
  signals are combined by hand (`anySignal` in `src/api/request.ts`); without that an older phone
  would send no request at all.
- **From the dataset, not from the text:** the first month of the record and the list of covered
  regions on the start screen come from `GET /meta`.
- **Tooltips do not outlive their numbers:** a calendar tooltip that is still open when another area
  or period arrives is dropped, so it never describes cells it was not opened for.

Checked against the backend running on the real FIRMS record (2000 to 2025, all countries): the three
example areas, a change of period, a small area, an area without fires and an area above the limit.

## Fallback mode: saved answers

A demo must survive a server that is down. Answers of the real API are saved as static files in
`public/snapshot/` and shipped with the app (`src/api/snapshot.ts`).

- **What is saved:** `/meta`, `/method/validation`, and for every example area `/calendar` (the whole
  record, with `series=raw`), `/current` and the daily values of every year (packed as runs of
  consecutive days, a tenth of the size of the `/daily` answers). About 390 KB in twelve files. The numbers are real: the
  snapshot script refuses an API whose data version looks synthetic.
- **When it is used:** every request asks the server first. If the server cannot be reached (no
  connection, timeout, a gateway error), the saved answer is shown instead and a strip under the
  header says so, with the date of the snapshot and a "Try the server again" button. An error the
  server returned on purpose (area too large, no data) is never replaced. After a failure the server
  is not asked again for a minute, so a hanging server does not slow every click.
- **What works without the server:** the three example areas with any period, the "original sensors"
  view, the "Now" panel, both charts, the daily calendar, the "Method" page, all PNG downloads and the monthly table as CSV. A change of period is
  computed on the client exactly as the API does it (months, yearly totals, the most active year, the
  total, the trend); this was compared with the live API for three areas and three periods.
- **What does not:** a drawn or typed area, the hot spots of a month on the map, and the hot spot
  CSV. A copy built with `VITE_API_FALLBACK=only` does not offer the hot spots at all. They get a message that the saved
  data covers the example areas only.
- **Refreshing the snapshot:** start the backend on the real record and run `npm run snapshot`
  (or `npm run snapshot -- https://host/api/v1`). Commit the changed files.

`VITE_API_FALLBACK` chooses the mode: `auto` (default outside the mocks), `only` (never ask a server:
a static site without a backend), `off`.

## Deployment

The build is a static site: `npm run build` writes it to `dist/`. Addresses inside it are relative,
so it works from the root of a domain or from any folder. Routing uses the part of the address after
`#`, so the host needs no rewrite rules.

- **Without a backend:** build with `VITE_API_FALLBACK=only`. The site runs on the saved answers.
- **With a backend:** set `VITE_API_URL` to the address of the API and `VITE_API_FALLBACK=auto`; add
  the address of the site to `CORS_ORIGINS` of the backend.
- **Netlify:** base directory `frontend`; `netlify.toml` there holds the command, the folder and the
  variables. **Vercel:** root directory `frontend`, `vercel.json` there; set the variables in the
  project settings. **Cloudflare Pages:** root `frontend`, command `npm run build`, output `dist`,
  variables `NODE_VERSION=22` and `VITE_API_FALLBACK=only`.
- **Without connecting the repository:** build locally and upload the `dist` folder (Netlify Drop,
  Cloudflare Pages direct upload, `vercel deploy`).

## End-to-end tests

`npm run e2e` walks the main user scenario in a real browser (`e2e/main-scenario.spec.ts`, Playwright).
Before the first run: `npx playwright install chromium`.

- **What runs:** the app is built as the public demo is (`VITE_API_FALLBACK=only`) into `dist-e2e/`
  and served by `vite preview`. It needs neither a backend nor data files.
- **The scenario** is the one of the demo: open the site, choose an example area, read the calendar,
  switch to anomalies, look at "Now", shorten the period, download the monthly table and the calendar
  image, open "Method", come back, and reopen the same view from its link in a new tab.
- **Real numbers, no fixed values:** what is on screen is compared with the files of
  `public/snapshot/`, so the test stays valid after `npm run snapshot`.
- **Downloads are opened:** the CSV must have a row per month of the period, and the PNG must be a
  real image and not an empty canvas.
- **No other hosts:** requests that leave the app (map tiles, imagery) are cut, so the test does not
  depend on the network. The map itself is covered by its own unit tests.
- **Phone:** the same view at 360 px must not scroll sideways.

## Environment variables

Vite reads the `.env` file from the repository root (see `.env.example`).

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Address of the real API. Defaults to `http://localhost:8000/api/v1` |
| `VITE_API_MOCKS` | `true` or `false`: force the mocks on or off |
| `VITE_API_FALLBACK` | `auto`, `only` or `off`: when to show the saved answers of `public/snapshot/` |

Without `VITE_API_MOCKS`, the mocks are on in `npm run dev` and in tests, and off in `npm run dev:api` and in the build.

## Zone boundaries

This folder has its own `package.json`. Files in `pipeline/`, `backend/` and `contract/` are not edited from this zone
(the contract changes through a separate pull request, see `contract/README.md`).
