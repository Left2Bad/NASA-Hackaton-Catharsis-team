# Data & Resources Usage (draft)

Draft for the "Data & Resources Usage" field of the Space Apps submission. Every link below was opened and checked
on 2026-11-14. Sections marked `TODO(user)` must be written or confirmed by the team before submission.

## NASA data

All fire detections come from **NASA FIRMS** (Fire Information for Resource Management System), part of NASA's LANCE
and ESDIS: https://www.earthdata.nasa.gov/data/tools/firms

| What we used | Product | How we got it | Link |
| --- | --- | --- | --- |
| MODIS Collection 6.1 active fires, Terra + Aqua, November 2000 – 2025 (standard processing) | MCD14ML (monthly standard-quality locations, served by FIRMS) | FIRMS yearly country summaries ("Download yearly summary by country") on the Archive Download page | https://firms.modaps.eosdis.nasa.gov/download/ |
| VIIRS 375 m active fires, Suomi NPP, January 2012 – 2025 (standard processing) | VNP14IMGTML (standard-quality locations, served by FIRMS) | FIRMS yearly country summaries | https://firms.modaps.eosdis.nasa.gov/download/ |
| VIIRS 375 m active fires, NOAA-20 (JPSS-1), April 2018 – 2025 (standard processing) | VJ114IMGTML (standard-quality locations, served by FIRMS) | FIRMS yearly country summaries | https://firms.modaps.eosdis.nasa.gov/download/ |
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

TODO(user): confirm or rewrite this paragraph in the team's own words.

> We used **Claude Code** (Anthropic, https://www.anthropic.com/claude-code) as an AI coding assistant. It helped write
> and test the code of the data pipeline and the backend, and helped translate and edit the documentation into English.
> The team chose the challenge approach, the harmonization method and the validation design, reviewed every change
> before merging, and wrote the Project Page text and the presentation.

TODO(user): list what the team did without AI, and say whether AI was used for the frontend, images, the video or the voice-over.
