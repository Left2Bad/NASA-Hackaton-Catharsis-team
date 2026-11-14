# contract/examples/

Example API requests and responses. **The numbers are synthetic** — they are produced by the script
`contract/tools/generate_examples.py` and are meant for mock-ups and mocks. They are not the result of processing FIRMS data.
The marker of synthetic data in the responses themselves: `data_version` = `synthetic-example-0.1`.

The area in the examples is a rectangle in the steppe zone (61–71° E, 51–55° N) with two burning
waves, in spring and in late summer. The period runs from November 2000 to 13 November 2026.

| File | Endpoint | Schema |
| --- | --- | --- |
| `health.json` | `GET /health` | `Health` |
| `meta.json` | `GET /meta` | `Meta` |
| `calendar.request.json` | `POST /calendar`, request body | `AreaQuery` |
| `calendar.response.json` | `POST /calendar`, unified series | `CalendarResponse` |
| `calendar_raw.response.json` | `POST /calendar` when `series` = `raw` | `CalendarResponse` |
| `current.response.json` | `POST /current` | `CurrentResponse` |
| `points.request.json` | `POST /points`, request body | `PointsQuery` |
| `points.response.json` | `POST /points` | `PointsResponse` |
| `daily.request.json` | `POST /daily`, request body | `DailyQuery` |
| `daily.response.json` | `POST /daily` | `DailyResponse` |
| `export_points.request.json` | `POST /export/points.csv`, request body | `ExportPointsQuery` |
| `export_points.csv` | `POST /export/points.csv` | columns in `openapi.yaml` |
| `export_calendar.csv` | `POST /export/calendar.csv` | columns in `openapi.yaml` |
| `method_validation.response.json` | `GET /method/validation` | `ValidationResponse` |
| `error_*.json` | error responses | `ErrorResponse` |

What to check in the interface with these examples:

- **Extreme year** — 2010, August is almost four times the median.
- **Incomplete month** — November 2026: `partial` = true, `percentile` and `category` are `null`.
- **Preliminary data** — months from July 2026: `preliminary` = true.
- **Source change** — `source` changes in August 2002, February 2012 and November 2026.
- **Sensor outage** — July and August 2022, July and November 2024: `sensor_gap` = true,
  `source` = `VIIRS_N20` in the middle of the Suomi NPP era, and `warnings` contains `SENSOR_GAP`.
- **Trend line** — `summary.trend_line`: the two points used to draw the trend of the yearly totals.
- **Interval** — in the MODIS era `low` and `high` differ from `value`; in the Suomi NPP era they equal it.
