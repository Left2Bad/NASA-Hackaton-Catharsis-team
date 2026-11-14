# Which contract fields the screen is drawn from

Every requirement F1 to F27 of the project specification, checked against `contract/openapi.yaml`
(version 0.2.0) and the examples in `contract/examples/`.

**Result: every requirement with the "Must have" priority has the fields it needs. Nothing blocks the work.**
Seven smaller questions about the contract came up; three were settled in contract 0.2.0, and the rest are
listed in the [last section](#questions-and-proposals-for-the-contract).

How to read the tables: `meta`, `calendar`, `current`, `points`, `daily`, `validation` are the responses of
`GET /meta`, `POST /calendar`, `POST /current`, `POST /points`, `POST /daily`, `GET /method/validation`.
"Request" means fields of the `AreaQuery` body. "Client" means the frontend computes it and needs nothing from the API.

## Area and period

| ID | Requirement | Where it comes from | Notes |
| --- | --- | --- | --- |
| F1 | Drawing a rectangle and a polygon | Request: `geometry` (`Polygon` or `MultiPolygon`) | A rectangle is sent as a `Polygon` of 5 points. The client closes the ring; order is longitude, latitude |
| F2 | Entering bounds, or a point with a radius | Request: `geometry` | The contract has no circle: the client builds a polygon of 64 vertices from the point and the radius |
| F3 | Example areas | `meta.presets[]`: `id`, `name`, `description`, `geometry` | `id` is stable, so it also goes into the page address (F26) |
| F4 | Period in years | Request: `start_year`, `end_year`. Limits of the choice: `meta.first_date`, `meta.last_date` | Without these fields the server takes the whole record. Baseline: `baseline` in the request, the one actually used in `calendar.baseline` |
| F5 | Area limit and a warning for a small area | `meta.limits.max_area_km2` for a check before the request. Error 413 `AREA_TOO_LARGE`. Warning `AREA_SMALL` in `calendar.warnings[]`. In the response: `calendar.area_km2`, `calendar.cells` | Before the request the client computes the geodesic area itself. Coverage: `meta.coverage`, error 404 `NO_DATA`, warning `PARTIAL_COVERAGE` |
| F6 | Loading a GeoJSON file | Request: `geometry` | The client takes the geometry out of a `Feature` or a `FeatureCollection` and rejects other types itself |

## Calendar

| ID | Requirement | Where it comes from | Notes |
| --- | --- | --- | --- |
| F7 | Year-by-month grid | `calendar.months[]`: `year`, `month`, `value` | Months outside the record are absent from the response (January to October 2000, future months): those cells are drawn empty |
| F8 | Yearly total, monthly median | `calendar.yearly[]`: `year`, `total`, `complete`. `calendar.monthly_baseline[]`: `month`, `median` | Incomplete years (`complete` = false) are marked |
| F9 | Cell tooltip | `calendar.months[]`: `value`, `median`, `anomaly_pct`, `low`, `high`, `source`, `preliminary`, `partial`, `percentile`, `category`, `sensor_gap`. Source name: `meta.sources[].label` by `id` | When `anomaly_pct` = `null` (the median is 0), the tooltip shows the difference `value − median` in detections |
| F10 | "Detections" or "anomaly" mode | `calendar.months[].value` and `calendar.months[].anomaly_pct` | Switching needs no new request. Cells with `anomaly_pct` = `null` get a neutral color |
| F11 | Accessible scales and a legend with numbers | Client | Legend boundaries are computed from `value` and `anomaly_pct` |
| F12 | Quantile or logarithmic scale | Client, from `calendar.months[].value` | Quantiles are computed over all months of the response |
| F13 | Hot spots of a month on the map | `points.features[]`: `geometry.coordinates`, `properties.*`. `points.total`, `points.truncated` | Request `PointsQuery`: `geometry`, `year`, `month`. Limit: `meta.limits.max_points` |
| F14 | Daily calendar of a year | `daily.days[]`: `date`, `value`, `preliminary` | Request `DailyQuery`: `geometry`, `year`, `metric` |

## Analytics

| ID | Requirement | Where it comes from | Notes |
| --- | --- | --- | --- |
| F15 | "Now" panel | `current`: `as_of`, `year`, `month`, `days_elapsed`, `value`, `baseline_same_days.median`, `anomaly_pct`, `percentile`, `category`, `source`, `preliminary`. Chart: `current.cumulative[]`: `day`, `value`, `median` | The status "normal / above / extreme" comes from `category` (5 values). See question 7 |
| F16 | Summary of 4 numbers | `calendar.summary`: `peak_year`, `peak_month`, `total`, `trend_pct_per_decade` | The trend direction is the sign of the number. `null` means "not enough data" |
| F17 | Season profile | `calendar.monthly_baseline[]`: `median`, `p10`, `p90`. The line of a year: `calendar.months[]` with that `year` | No new request: the year is picked from the response already loaded |
| F18 | Yearly totals with a trend | `calendar.yearly[]`: `year`, `total`, `complete`. Trend line: `calendar.summary.trend_line` | The line is drawn through two points: `start_year`, `start_value` and `end_year`, `end_value` |
| F19 | "Harmonized record / original sensors" | Request: `series` = `raw`. Response: `calendar.months[].raw`: `modis`, `viirs_snpp`, `viirs_n20` | `value` stays the harmonized value, so both series are drawn from one response |
| F20 | Comparing two areas or two years | Two `/calendar` requests; one response for two years | — |
| F21 | FRP mode | Request: `metric` = `frp`. Label: `calendar.unit`, `calendar.metric` | See question 5 |

## Export and the rest

| ID | Requirement | Where it comes from | Notes |
| --- | --- | --- | --- |
| F22 | CSV of hot spots | `POST /export/points.csv`, request `ExportPointsQuery`: `geometry`, `start_date`, `end_date`. Error 413 `EXPORT_TOO_LARGE`, limit `meta.limits.max_export_rows` | The years of the period become dates: January 1 of `start_year` to December 31 of `end_year`, but not later than `meta.last_date`. See questions 4 and 6 |
| F23 | CSV of the monthly table | `POST /export/calendar.csv`, request `AreaQuery` | The columns match `calendar.months[]`, so in the fallback mode the client can build the file itself |
| F24 | PNG with a caption | Client. Caption: the example name or the bounds of the area, `calendar.area_km2`, the years of the period, `calendar.data_through`, `meta.data_version` | The text about the data source (NASA FIRMS) is static |
| F25 | "Method" page | `validation`: `calibration_period`, `test_period`, `regions[]` (`name`, `metrics.pearson_r`, `metrics.bias_pct`, `metrics.mape_pct`, `metrics.n_months`, `series[]`), `seams[]` (`label`, `ratio_harmonized`, `ratio_naive`), `limitations[]`. Makeup of the record: `meta.sources[]` | The validation series cover only 2021 to 2025. The "before and after" chart for the whole period comes from a `/calendar` request with `series` = `raw` for an example area |
| F26 | State in the page address | Client | The address holds the example `id` or coordinates, the years and the mode |
| F27 | Two languages | Client: labels by `id` and `code`, with the server text as a fallback | See question 3 |

## Screen elements outside the F list

| Element | Where it comes from |
| --- | --- |
| Empty result ("no fires detected") | Response 200: `calendar.summary.total` = 0, `calendar.summary.peak_year` = `null` |
| Error | `error.code`, `error.message`. Codes: `INVALID_GEOMETRY`, `INVALID_REQUEST`, `AREA_TOO_LARGE`, `EXPORT_TOO_LARGE`, `NO_DATA`, `INTERNAL` |
| "Preliminary" mark | `calendar.months[].preliminary`, `current.preliminary`, `daily.days[].preliminary`; the boundary is `meta.last_standard_date`; warning `PRELIMINARY_DATA` |
| Partial month | `calendar.months[].partial`; its `percentile` and `category` are `null` |
| Warnings above the calendar | `calendar.warnings[]`, `current.warnings[]`: `code`, `message` |
| Satellite outages | `calendar.months[].sensor_gap` for the month, warning `SENSOR_GAP` for the response |
| Data version and date in the footer | `meta.data_version`, `calendar.data_through` |
| Which sensor leads the record | `meta.sources[]`: `id`, `label`, `start`, `end`; per month: `calendar.months[].source` |

## Questions and proposals for the contract

| No. | Issue | Affects | Status |
| --- | --- | --- | --- |
| 1 | The specification asks to mark months with satellite outages, but a month had no such flag | F9 | Settled in 0.2.0: the optional field `sensor_gap` in `MonthValue` |
| 2 | `trend_pct_per_decade` gave a slope in percent without saying of what and by which method, so a trend line could not be drawn from it | F16, F18 | Settled in 0.2.0: the method is described, and the optional `trend_line` gives the line as two points |
| 3 | Server texts come in one language: `presets[].name`, `sources[].label`, `warnings[].message`, `error.message`, `seams[].label`, `regions[].name`, `limitations[]` | F27 | Partly settled in 0.2.0: identifiers are stable and the client translates by `id` and `code`. `limitations[]` has no codes, so the second language takes that text from `docs/methodology.md` |
| 4 | The CSV must name the data source, but the examples have only a header row | F22, F23 | Open. Decide where NASA FIRMS is named: in the file name, in a separate column or in the text next to the button. A comment line at the top of the file would break opening it in Excel |
| 5 | `unit` is a free string. For `metric` = `count` the examples use `viirs_snpp_equivalent_detections`; the value for `frp` is not named anywhere | F21 | Open. List the allowed values of `unit` in the schema description |
| 6 | The `Content-Disposition` header is described only for `points.csv`, and without `Access-Control-Expose-Headers` the client cannot read it anyway | F22, F23 | No change needed: the client sets the file name itself |
| 7 | `/current` takes `AreaQuery`, but `start_year`, `end_year` and `series` make no sense for it | F15 | Open. Say in the description that only `geometry`, `baseline` and `metric` are used |
