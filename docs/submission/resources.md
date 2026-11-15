# Data & Resources Usage

Text for the "Data & Resources Usage" field of the Space Apps submission. Every link below was opened and checked
on 2026-11-14.

## NASA data

All fire detections come from **NASA FIRMS** (Fire Information for Resource Management System), part of NASA's LANCE
and ESDIS: https://www.earthdata.nasa.gov/data/tools/firms

| What we used | Product | How we got it | Link |
| --- | --- | --- | --- |
| MODIS active fires, Terra from November 2000 and Aqua from mid-2002, to 2025 (standard processing): Collection 6 for 2000–2022 and Collection 6.1 from 2023, as served in the FIRMS yearly archives | MCD14ML (monthly standard-quality locations, served by FIRMS) | FIRMS yearly country summaries ("Download yearly summary by country") on the Archive Download page | https://firms.modaps.eosdis.nasa.gov/download/, files at https://firms.modaps.eosdis.nasa.gov/country/ |
| VIIRS 375 m active fires, Collection 2, Suomi NPP, January 2012 – 2025 (standard processing) | VNP14IMGTML (standard-quality locations, served by FIRMS) | FIRMS yearly country summaries | https://firms.modaps.eosdis.nasa.gov/download/ |
| VIIRS 375 m active fires, Collection 2, NOAA-20 (JPSS-1), April 2018 – 2025 (standard processing) | VJ114IMGTML (standard-quality locations, served by FIRMS) | FIRMS yearly country summaries | https://firms.modaps.eosdis.nasa.gov/download/ |
| 2026: MODIS, VIIRS Suomi NPP and VIIRS NOAA-20, standard (SP) and near-real-time (NRT) | sources `MODIS_SP`, `MODIS_NRT`, `VIIRS_SNPP_SP`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA20_NRT` | FIRMS Area API with a free MAP_KEY | https://firms.modaps.eosdis.nasa.gov/api/area/ |

Product pages and documentation:

- MODIS/Aqua Terra Thermal Anomalies/Fire locations 1km FIRMS NRT (Vector data), MCD14DL, Collection 6.1,
  DOI [10.5067/FIRMS/MODIS/MCD14DL.NRT.0061](https://doi.org/10.5067/FIRMS/MODIS/MCD14DL.NRT.0061):
  https://www.earthdata.nasa.gov/data/catalog/lancemodis-mcd14dl-6.1nrt
- MODIS Collection 6 and 6.1 Active Fire Product User's Guide (MCD14ML is described there and in the FIRMS FAQ):
  https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf
- MODIS active fire team (University of Maryland): https://modis-fire.umd.edu/af.html
- VIIRS (S-NPP) I Band 375 m Active Fire Product NRT (Vector data), VNP14IMGTDL_NRT, version 2,
  DOI [10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002](https://doi.org/10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002):
  https://www.earthdata.nasa.gov/data/catalog/lancemodis-vnp14imgtdl-nrt-2
- VIIRS (NOAA-20/JPSS-1) I Band 375 m Active Fire Product NRT (Vector data), VJ114IMGTDL_NRT, version 2,
  DOI [10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002](https://doi.org/10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002):
  https://www.earthdata.nasa.gov/data/catalog/lancemodis-vj114imgtdl-nrt-2
- VIIRS I-Band 375 m Active Fire Data (algorithm and attribute fields):
  https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data
- FIRMS FAQ (standard-quality ML products, NRT vs standard processing, Suomi NPP end of data on 2 November 2026):
  https://www.earthdata.nasa.gov/data/tools/firms/faq
- FIRMS Area API key: https://firms.modaps.eosdis.nasa.gov/api/map_key/

Acknowledgement (as requested by FIRMS): We acknowledge the use of data and/or imagery from NASA's Fire Information
for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near
real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and
Information System (ESDIS).

## Other NASA services

- **NASA GIBS** (Global Imagery Browse Services), Blue Marble Shaded Relief and Bathymetry layer, used as the satellite
  basemap in the web app: https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api
  (developer docs: https://nasa-gibs.github.io/gibs-api-docs/). We acknowledge the use of imagery provided by services from
  NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).

## Non-NASA resources

- **OpenFreeMap** vector basemap (Positron style), free and without an API key: https://openfreemap.org/ ;
  map data © OpenMapTiles (https://openmaptiles.org/) and © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).
- Open-source software:
  - pipeline and backend: DuckDB (https://duckdb.org/), FastAPI (https://fastapi.tiangolo.com/), pandas (https://pandas.pydata.org/),
    Apache Arrow / PyArrow (https://arrow.apache.org/), Shapely (https://shapely.readthedocs.io/), pyproj (https://pyproj4.github.io/pyproj/);
  - frontend: React (https://react.dev/), Vite (https://vite.dev/), MapLibre GL JS (https://maplibre.org/), Terra Draw (https://terradraw.io/).

No commercial or proprietary data was used. The project code is released under the Apache License 2.0.

## Use of AI

The archived FIRMS data were collected, and the fresh 2026 data were downloaded step by step: the team ran each step
of the download scripts (`pipeline/download_archives.py`, `pipeline/fetch_api.py`) and checked its result by hand. The
project architecture was designed by the team on its own and written down as the API contract (`contract/openapi.yaml`)
and the repository skeleton with Claude Code (Claude Fable 5.2); we then built a prototype, which was developed further with the help
of AI: **Claude Code** (Anthropic, https://www.anthropic.com/claude-code), mainly with the Claude Opus 5.5 model
(Claude Fable 5.2 and Claude Sonnet 5.5 were also used for some tasks). Because of the amount of work (from 11:00 on the
first day of the hackathon to 14:00 on the second), many parts of the code were written with AI and then checked and
tested by hand to avoid problems. Errors in the AI's output were fixed with the help of our mentors and by manual edits.

The web application (`frontend/`) was built the same way. The teammate responsible for it set the tasks one by one
and decided what the interface must do; the code, its tests and its documentation were written with **Claude Code**
(Claude Fable 5.2); the last fixes of the interface (pull requests #42, #44 and #45) were made by the other teammate
with Claude Opus 5.5. Every change came as a pull request, which was read and then checked by hand in the browser
before it was merged.

The English localization was made with **Google Gemini Hydrogene** (Google, https://gemini.google.com/). The
documentation, the code comments, the API contract and the API messages were also translated from Russian and edited
with Claude Code (Claude Opus 5.5 and Claude Fable 5.2); the Russian original of the method is kept as
`docs/methodology.ru.md`.

The text of the Space Apps project page was written by the team in Russian; Claude Code (Claude Opus 5.5) translated
it into English and corrected the grammar. At the team's request it also added the validation numbers, the list of
the app's features and the links, taken from the repository and the live site.

The pitch deck (`docs/demo/slides/`) and the storyboard of the video (`docs/demo/README.md`) were drafted with
Claude Code (Claude Fable 5.2; slides 6 and 7 were finished with Claude Opus 5.5). The pictures in the deck are real
screenshots of the running application on real FIRMS data, taken by a script (`frontend/scripts/demo-shots.mjs`). None
of the screenshots or numbers is AI-generated, and the deck has no generated illustrations, music or voice-over.

The 30-second pitch video is built from real screenshots of the live site (https://nasa.pin-planet.org), taken by a
script; nothing in its picture is generated except what is drawn on top: the zoom, the highlight rings, the pointer, the
captions and the end card were made in code with Remotion (https://www.remotion.dev/), written with Claude Code
(Claude Opus 5.5). Its voice-over is generated with **ElevenLabs** (https://elevenlabs.io, model eleven_v3) from a
script drafted with Claude Code. The background music is not generated: "Music by Dmitrii Spis from Pixabay"
(https://pixabay.com/users/nastelbom-48128234/, track 617068, Pixabay Content License); the click sounds are
synthesized in code. Sources: `docs/demo/video/`.

Synthetic numbers exist only in `contract/examples/` (made by `contract/tools/generate_examples.py`), in the
development mocks of the frontend, in the backend test fixtures and in the early development screenshots `b3-*` to
`b9-*` in `docs/demo/screenshots/` (taken on the mocks before the real API), and they are marked as synthetic. The live
site, the deck and every other result in this repository use only real FIRMS data.
