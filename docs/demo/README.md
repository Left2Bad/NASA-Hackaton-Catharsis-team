# docs/demo/ — zone of developer B

Materials for the presentation: the demo script, screenshots, slides and the link to the video.

The pitch for the Space Apps submission is **one of two**: a video of at most 30 seconds, or a deck of at most
7 slides. Both are prepared here; everything that is uploaded is in English.

| What | Where |
| --- | --- |
| Script and storyboard of the 30-second video | this file, below |
| Deck, 7 slides: title, problem, solution (two slides), NASA data, plans, team | [slides/burn-calendar-pitch.pdf](slides/burn-calendar-pitch.pdf), source [slides/slides.html](slides/slides.html) |
| Frames of the demo | `screenshots/demo-NN-*.jpg`, 1920 × 1200 |
| Video | not recorded: the pitch is submitted as the deck |

If a video is recorded later, the team says the voice-over in its own words and names every AI tool it used (voice,
music) in the "Data & Resources Usage" field of the submission
(see [../submission/resources.md](../submission/resources.md)).

Slide 7 carries the names of the team and the address of the site. Before the deck is submitted, upload the PDF
where anyone can open it without signing in, for example Google Drive with "Anyone with the link" (the rules do not
accept a link to GitHub), and check the link in a private window.

The deck is printed from `slides.html` with `npm run demo:slides` in `frontend/`, and the frames are taken again with
`npm run demo:shots -- https://nasa.pin-planet.org` after any change of the interface.

## Video: 30 seconds

One area carries the whole story: **Northern California**. All numbers below are what the app shows on the real
FIRMS record with data through 2026-11-13. If the data is refreshed before recording, read the numbers from the
screen again and change the voice-over to match.

| # | Time | On screen | Frame | Voice-over |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:06 | Start screen with the world map; the title "Burn Calendar" over it | `demo-01-start` | Two NASA sensors count fires differently. Join their records, and fires seem to jump fourfold in 2012. |
| 2 | 0:06–0:11 | "Method" page, the chart "What harmonization changes": dashed MODIS far below, the solid line on one scale | `demo-08-method-harmonization` | Burn Calendar converts every MODIS detection to the VIIRS scale, cell by cell. |
| 3 | 0:11–0:16 | Click "Northern California": the calendar fills in; the pointer stops on September 2020 and the tooltip opens | `demo-02-calendar`, `demo-03-tooltip` | Pick any area: one consistent record, every month since 2000. |
| 4 | 0:16–0:19 | Click "Anomaly": the calendar turns blue and orange | `demo-04-anomaly` | Blue is quieter than usual, orange is worse. |
| 5 | 0:19–0:24 | Click "Now" in the links of the panel: "Above normal, +58.6 %" and the cumulative chart | `demo-05-summary-now` | Right now, Northern California runs 59 percent above normal. |
| 6 | 0:24–0:28 | "Method" page, "How it was checked": the forecast lies on the VIIRS line; correlation 0.999 | `demo-09-method-validation` | Checked on years the method never saw: correlation 0.99. |
| 7 | 0:28–0:30 | End card: name, team, "Data: NASA FIRMS", the address of the site | slide 1 of the deck | Burn Calendar: open source, built on NASA FIRMS. |

The voice-over is 74 words: about 30 seconds at a calm pace. Read it once against a stopwatch before recording;
if it runs long, drop the sentence of shot 4, which the picture explains by itself.

### How to record

1. Run the app against the real API, so the screen has no "Saved demo data" strip: start the backend on the team
   data archive (`backend/README.md`, `DATA_DIR` points to the unpacked archive, `CORS_ORIGINS=http://localhost:5174`),
   then in `frontend/` run `npm run dev:api -- --port 5174`.
2. Browser window 1920 × 1080, zoom 100 %, no bookmarks bar, no other tabs. Record the window, not the whole screen.
3. Before recording, click through the whole route once: the answers are then cached and every click is instant.
4. Record shots 2 and 6 ("Method") and shots 3 to 5 (calendar) as two separate takes and join them: the route
   Calendar → Method → Calendar → Method wastes seconds on navigation.
5. Move the pointer slowly and stop it before each click. Cut the pauses when editing, not while recording.
6. Record the voice separately and lay it over the picture: it is easier to fit into 30 seconds.
7. Export at 1080p. The file must be **30 seconds or shorter**: check the length of the exported file.

## Live demo: 2 minutes

For the local jury, where the app is shown by hand. The route is the main user scenario, the one the end-to-end
test walks (`frontend/e2e/main-scenario.spec.ts`):

1. Open the site and choose the example area "Northern California".
2. The year-by-month calendar: 2020 and 2021 stand out; hover a cell for the exact numbers and the likely range.
3. Switch to the anomaly mode: every month against the median of the same calendar month.
4. The "Now" panel: the current month against the same days of the earlier years.
5. The season profile and the yearly totals with the trend.
6. Download the monthly table (CSV) and the calendar (PNG); copy the link to this view.
7. The "Method" page: the sensors as recorded against the harmonized record, then the check on held-out years.

If the server is down, the app switches to the saved answers of the real API by itself and says so under the
header; the three example areas keep working.

## Retaking the frames and the deck

From `frontend/`, with the app running on real data (see "How to record"):

```bash
npm run demo:shots -- http://localhost:5174
```

```bash
npm run demo:slides
```

The first command takes `screenshots/demo-NN-*.jpg` again, the second prints `slides/slides.html` into the PDF.
After a change of the interface or of the data, run both and check the numbers quoted in the voice-over and on
the slides.

## Screenshots

The `screenshots/` folder. File names start with the task a screenshot belongs to.

The `demo-*` files are the frames of the video and of the deck (taken by `npm run demo:shots`); the others were
taken task by task and show the app at that stage.

| File | What it shows |
| --- | --- |
| `demo-01-start.jpg` | Demo frame: the start screen with the world map |
| `demo-02-calendar.jpg` | Demo frame: the burn calendar of Northern California, 2000 to 2026 (real FIRMS data through 2026-11-13) |
| `demo-03-tooltip.jpg` | Demo frame: the tooltip of September 2020 with the value, the median and the level |
| `demo-04-anomaly.jpg` | Demo frame: the same calendar in the anomaly mode |
| `demo-05-summary-now.jpg` | Demo frame: the summary and the "Now" panel, November 1 to 13, 2026 |
| `demo-06-season-yearly.jpg` | Demo frame: the season profile with 2020 over the typical season, and the yearly totals |
| `demo-07-downloads.jpg` | Demo frame: the "Downloads" section |
| `demo-08-method-harmonization.jpg` | Demo frame: the "Method" page, the sensors as recorded against the harmonized record |
| `demo-09-method-validation.jpg` | Demo frame: the "Method" page, the forecast from MODIS against VIIRS on the test years |
| `demo-10-method-seams.jpg` | Demo frame: the "Method" page, the table of the seams |
| `demo-11-phone.jpg` | Demo frame: the anomaly calendar on a phone 360 px wide |
| `b3-layout-laptop.jpg` | Screen layout on a laptop: the map on the left, the panel with the calendar on the right |
| `b3-layout-phone-top.jpg`, `b3-layout-phone-calendar.jpg` | The same screen on a phone |
| `b3-scale-detections.jpg` | The detections scale under three kinds of color-vision deficiency |
| `b3-scale-anomaly.jpg` | The anomaly scale under three kinds of color-vision deficiency |
| `b4-map-example-area.jpg` | The map with an example area and its calendar |
| `b4-map-editing.jpg` | A selected area: handles on the corners and on the middle of each side |
| `b4-map-satellite.jpg` | NASA Blue Marble satellite imagery as the basemap |
| `b4-map-phone.jpg` | The map on a phone |
| `b5-coordinate-form.jpg` | The form for setting the area by bounds or by a point with a radius |
| `b5-point-and-radius.jpg` | An area set as a point with a 150 km radius |
| `b5-area-limit.jpg` | The message for an area above the size limit |
| `b6-calendar-laptop.jpg` | The burn calendar with yearly totals and the marks of preliminary months |
| `b6-calendar-tooltip-phone.jpg` | The cell tooltip on a phone |
| `b7-anomaly-mode.jpg` | The calendar in the anomaly mode: blue below the median, orange above |
| `b8-now-summary-laptop.jpg` | The summary of four numbers and the "Now" panel: level, level strip, cumulative chart |
| `b8-now-chart-hover.jpg` | The cumulative chart with a day picked by the pointer |
| `b8-now-summary-phone.jpg` | The summary and the "Now" panel on a phone |
| `b9-season-yearly-laptop.jpg` | The season profile with the year 2010 over the typical season, and the yearly totals with the trend line |
| `b9-season-yearly-phone.jpg` | The same two charts on a phone |
| `b10-server-unreachable.jpg` | The server cannot be reached: the message with the "Try again" button (real backend, stopped) |
| `b10-empty-result.jpg` | An area without fires: the message in place of the calendar (real backend on its test data) |
| `b10-real-data-calendar.jpg` | Real FIRMS data, 2000 to 2025: the burn calendar of the Southern Amazon |
| `b10-real-data-now.jpg` | Real FIRMS data: the summary and the "Now" panel of the Southern Amazon |
| `b10-real-data-charts.jpg` | Real FIRMS data: the season profile and the yearly totals of the Southern Amazon |
| `b11-export-calendar.png` | A file the app exports: the burn calendar of the Southern Amazon with its caption (real FIRMS data) |
| `b11-export-season-profile.png` | Exported season profile: 2004 over the typical season |
| `b11-export-yearly-totals.png` | Exported yearly totals with the trend line |
| `b11-export-calendar-anomaly.png` | Exported calendar in the anomaly mode |
| `b11-export-current-month.png` | Exported chart of the current month with its own caption |
| `b12-method-top.jpg` | The "Method" page: what the sensors recorded and the harmonized record, Southern Amazon (real FIRMS data) |
| `b12-method-checks.jpg` | The "Method" page: the forecast from MODIS against VIIRS on the test years, with the metrics |
| `b12-method-details.jpg` | The "Method" page: limitations and the method text from `docs/methodology.md` |
| `b16-original-sensors.jpg` | The "original sensors" view: before 2012 the cells show MODIS as recorded, several times paler; the tooltip names the factor |
| `b16-hot-spots.jpg` | The hot spots of September 2020 on the map after a click on that month (the 20,000 strongest of 165,893) |
| `b16-hot-spots-satellite.jpg` | The same hot spots over the NASA Blue Marble imagery |
| `b16-daily-calendar.jpg` | The daily calendar of 2020: a row per month, a column per day |
| `b16-daily-phone.jpg` | The daily calendar on a phone 360 px wide |
| `b14-link-phone.jpg` | A phone 360 px wide, the view opened from a link: area, period and mode come from the address |
| `b13-fallback-banner.jpg` | The server is off: the app runs on the saved answers and says so under the header |
| `b11-downloads-section.jpg` | The "Downloads" section of the panel, with the warning about the row limit |
