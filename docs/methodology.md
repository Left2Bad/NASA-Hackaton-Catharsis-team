# MODIS and VIIRS harmonization method

Russian version: [methodology.ru.md](methodology.ru.md)

> This text goes to the "Method" page of the app and into the presentation.
> Code: `pipeline/`. The numbers below come from `data/harmonized/summary.json`, `data/validation/report.json` and
> `data/validation/checks.json` (data as of 13 November 2026).

## 1. Task

Merge the MODIS records (since November 2000) and the VIIRS records (since January 2012) into one consistent series,
expressed in "VIIRS Suomi NPP equivalent".

## 2. Data

NASA FIRMS, yearly "Country Yearly Summary" archives (all countries), standard processing:

| Sensor | Years | Detections per year | After the filters (section 3) |
| --- | --- | --- | --- |
| MODIS (Terra, Aqua): Collection 6 to 2022, Collection 6.1 from 2023 | 2000-11 – 2025 | 3.7–5.1 million (2003–2025) | 3.3–4.7 million |
| VIIRS 375 m Collection 2, Suomi NPP | 2012-01-20 – 2025 | 17–22 million | 14–18 million |
| VIIRS 375 m Collection 2, NOAA-20 | 2018-04 – 2025 | 18–23 million | 14–18 million |

In 2001, with Terra only, MODIS has 1.8 million detections.

2026 comes through the FIRMS Area API: standard-processing VIIRS up to 31 July (MODIS up to 31 August), and near-real-time
(NRT) data after that. Suomi NPP delivers data up to 2 November 2026. In total, 2026 has 35.6 million detections. The data
were fetched on 14 November around 10:00 UTC; that day was still being filled, so it is kept in the files but not served:
the last day of the series is 13 November (`last_complete_date`).

## 3. Preparation

- A single schema for all sensors (`pipeline/to_parquet.py`): coordinates, date/time, satellite, confidence class,
  brightness temperatures, FRP, day/night, type, country.
- Confidence: MODIS has a number 0–100, which we convert to a class (< 30 — low, 30–79 — nominal, ≥ 80 — high);
  VIIRS already has an l/n/h class. Low-confidence detections are dropped.
- Source type: we keep only `type = 0` (probable vegetation fire). Volcanoes (1),
  static sources — gas flares, factories (2) — and offshore objects (3) are dropped.
- **One static-source mask for all sensors.** MODIS and VIIRS type the same source differently: at Holuhraun (Iceland, 2014)
  MODIS marks the lava as type 2 (8,173 detections) while Suomi NPP marks it type 0 (49,781 detections); at Kilauea
  (Hawaii, 2018) MODIS has no type 0 detection and Suomi NPP has 31,423. A type filter alone would keep the lava in VIIRS
  only and make the VIIRS/MODIS ratio explode there. So `pipeline/grid.py` builds a mask of ~1 km cells (0.01°) where any
  sensor reported type 1, 2 or 3 in 2000–2025 (473,298 cells) and drops every detection in those cells, for every sensor.
  In 2020 the mask removes 0.7 % of the MODIS and 1.9 % of the VIIRS type-0 detections.
- Grid (`pipeline/grid.py`): 0.1° cell × day, separately for each satellite — the number of detections and the sum of FRP.
  The monthly grid is its aggregate.

## 4. Calibration

The coefficient is the ratio of the Suomi NPP sum to the other sensor's sum over the overlap period, computed on 1° cells,
with stepwise shrinkage "1° cell → 5° block → whole world" (an empirical Bayes estimator):

```text
r_world = ΣV / ΣM
r_block  = (V_block + A · r_world)  / (M_block + A)
r_cell = (V_cell + A · r_block) / (M_cell + A)          A = 50 detections of the source sensor
H(0.1° cell, t) = r_cell(1°) × M(0.1° cell, t)
```

In cells with many fires the coefficient is determined by the data of the cell itself; in sparse cells it is pulled towards the block,
and the block towards the world value. This way empty cells get no noisy coefficients. Days on which one of the satellites
did not report (section 5) are left out of the fit on both sides of the ratio.

Six sets: {detection count, FRP} × {MODIS Terra + Aqua, Terra only, NOAA-20}. World coefficients:

| Set | Detection count | FRP | Fitting period |
| --- | --- | --- | --- |
| MODIS Terra + Aqua → Suomi NPP | **4.04** | 0.89 | 2012-02 – 2020-12 |
| MODIS Terra only → Suomi NPP | **12.1** | 2.89 | 2012-02 – 2020-12 |
| NOAA-20 → Suomi NPP | **1.017** | 1.022 | 2018-04 – 2025-12 |

**Coefficient guard.** A 1° cell whose Terra + Aqua count ratio (shrunk towards the world value) is more than 4 times
above or below the world ratio sees different targets in MODIS and VIIRS rather than the same fires with a different
detection efficiency: gas-flare fields (Permian, Bakken, North Slope, Algeria, Egypt, Kuwait, Yamal) and lava left outside
the mask. In every MODIS set such a cell does not enter its 5° block and takes the block's value instead of its own ratio,
so one cell can no longer set the coefficient of a whole block. This concerns 36 cells holding 0.03 % of the MODIS
detections of the fit. The Terra + Aqua ratio is the test because the Terra-only ratio also carries a real diurnal signal:
in Central Africa fires burn in the afternoon, Terra's morning overpass sees 1–2 % of what Aqua sees, and Terra-only
coefficients of 400–500 are correct there while the Terra + Aqua ratio is normal.

| Largest coefficient | Before the mask and guard | Now |
| --- | --- | --- |
| Detections, Terra + Aqua | 468 (Holuhraun, Iceland) | 28.4 (North Slope flares, Alaska) |
| Detections, Terra only | 819 (Holuhraun) | 509 (Central Africa, diurnal cycle) |
| FRP, Terra + Aqua | 389 | 12.6 |

The 1° cells around Holuhraun had Terra + Aqua coefficients of 358–365 and now have 4.0–5.0; the Iceland box
(21–15° W, 63–65.5° N) showed 64,126 hotspots for 2010 and now shows 801, from 174 MODIS detections.

**Why the MODIS coefficients are fitted on 2012–2020 only.** Around 2020–2022 Terra and Aqua stopped
holding their nominal orbits: the Terra overpass drifts to earlier in the morning, the Aqua overpass to later in the day.
The Suomi NPP / Terra ratio stayed at 11.6–12.6 in 2012–2021 and rose to 13.4 (2022), 14.0 (2024) and 16.5 (2025);
the Terra-to-Aqua detection ratio fell from 0.47–0.53 to 0.37 (the Terra share of MODIS detections from 0.32–0.35 to 0.27).
Historical MODIS (2000–2012), to which the coefficients are applied, flew in nominal orbits — so the coefficients should be
fitted on nominal-orbit years.

## 5. Series assembly

The rule for choosing the lead source is a single function, `pipeline/lead.py`, used by both the pipeline and the backend.

| Period | Lead source | Transformation |
| --- | --- | --- |
| November 2000 – July 2002 | MODIS Terra | × "Terra only" coefficient |
| August 2002 – January 2012 | MODIS Terra + Aqua | × "Terra + Aqua" coefficient |
| February 2012 – October 2026 | VIIRS Suomi NPP | none (reference) |
| Suomi NPP outage months: 2022-07, 2022-08, 2024-07, 2024-11, 2026-07 | VIIRS NOAA-20 | × NOAA-20 → Suomi NPP coefficient |
| from November 2026 | VIIRS NOAA-20 | × NOAA-20 → Suomi NPP coefficient |
| a gap day of the lead satellite (below) | another satellite where one exists | × its coefficient |

- Aqua data starts on 4 July 2002; July 2002 is kept with Terra so that the period starts with a full month.
- February 2012 is complete for Suomi NPP: 4.33 S-NPP detections per MODIS detection against a median of 4.09 (January is incomplete, data starts on the 20th).
- Outage months are found automatically: the world-wide Suomi NPP / NOAA-20 ratio is below 85 % of the median
  (for example, 2024-07: 0.57 — the satellite was in safe mode). The list is in `data/outage_months.csv`.

**Sensor gap days.** Satellites also miss single days and short runs of days that do not move a monthly ratio. For every
day the pipeline compares each satellite's world-wide count with another satellite, relative to the median of the same ratio
over the surrounding 31 days; a day below a quarter (MODIS) or a half (VIIRS) of that median is a gap day of that satellite
(`data/gap_days.csv`). VIIRS days outside gaps stay at 0.56 of the median or above and gap days fall to 0.47 or below;
the MODIS Terra/Aqua ratio is noisier (0.5 % of days below ×0.55 and 0.5 % above ×1.84), hence the lower threshold. 191 gap days were found: Terra 72, Aqua 34, Suomi NPP 75, NOAA-20 10.

On a gap day of the lead satellite another satellite takes its place: Suomi NPP → NOAA-20 (from April 2018) or
Terra + Aqua (before), Aqua → Terra with the "Terra only" coefficient. This applies to 46 days, for example
10–12 March 2026, when Suomi NPP delivered nothing and the series had shown zero fires. A Terra gap in 2000–2012 cannot
be filled — for example 15 June – 3 July 2001, when Terra was the only MODIS satellite and did not report. Every month with
a gap day of its lead satellite (37 months, listed in `summary.json` as `sensor_gap_months`) is returned with
`sensor_gap = true`; where the gap could not be filled, the value may be understated.

## 6. Quality checks

Coefficients are fitted on some years, and on other years VIIRS Suomi NPP is predicted from the other sensor;
the comparison is over "5° block × month" pairs. WAPE is the weighted error Σ|forecast − actual| / Σactual.
Sensor gap days are left out of every check, on both sides.

**Main check (as in the API contract): fitted on 2012–2020, tested on 2021–2025.**

| Set | Pearson r | WAPE | Bias | r / WAPE with a single world coefficient |
| --- | --- | --- | --- | --- |
| Detections, Terra + Aqua | 0.992 | 13.3 % | −4.2 % | 0.982 / 19.2 % |
| Detections, Terra only | 0.948 | 27.2 % | −14.1 % | 0.884 / 42.6 % |
| Detections, NOAA-20 | 0.999 | 4.9 % | +0.2 % | 0.999 / 4.6 % |
| FRP, Terra + Aqua | 0.977 | 17.5 % | −3.2 % | 0.926 / 31.1 % |
| FRP, Terra only | 0.890 | 36.9 % | −15.1 % | 0.664 / 68.0 % |
| FRP, NOAA-20 | 0.997 | 7.6 % | +1.2 % | 0.999 / 6.4 % |

The MODIS bias over 2021–2025 is a consequence of the orbit drift (section 4), not of a method error.

**Check on nominal orbits: fitted on 2012–2016, tested on 2017–2020** — it shows the accuracy where
the coefficients are actually applied (2000–2012):

| Set | Pearson r | WAPE | Bias | r / WAPE with a single world coefficient |
| --- | --- | --- | --- | --- |
| Detections, Terra + Aqua | 0.993 | 12.4 % | −1.5 % | 0.981 / 19.8 % |
| Detections, Terra only | 0.976 | 20.9 % | +2.0 % | 0.931 / 38.7 % |
| FRP, Terra + Aqua | 0.984 | 15.1 % | +2.5 % | 0.958 / 27.4 % |
| FRP, Terra only | 0.943 | 30.6 % | +8.0 % | 0.780 / 61.2 % |

The spatial coefficients reduce the MODIS error by a third to a half compared with a single world coefficient.
For NOAA-20 the world coefficient is already almost exact (the sensors are identical), and the spatial one adds nothing.
Terra only has 1.7–2.1 times the WAPE of Terra + Aqua.

**`low`/`high` intervals.** On the pairs from the checks we compute the 10 % and 90 % quantiles of the "actual / forecast" ratio,
separately by forecast magnitude (bins `floor(log10(value + 1) · 2)`): for MODIS from the nominal-orbit check,
for NOAA-20 from the main one. Example for Terra + Aqua: at a forecast of ~10 detections per month the interval is ×0.33…×3.2,
at ~10,000 it is ×0.86…×1.22. The table is `data/uncertainty.parquet`; for Suomi NPP the interval is zero.

**Three regions** (`pipeline/validation.py` → `data/validation/report.json`, served by `/method/validation`).
Forecast — MODIS Terra + Aqua × the 1° cell coefficient (fitted on 2012–2020), actual — Suomi NPP, 2021–2025 by month.
Suomi NPP outage months stay in the series but do not take part in the metrics: the "actual" itself is understated there.
MAPE is the median monthly error |forecast − actual| / actual over months with actual > 0. Two baselines on the same
months (`data/validation/checks.json`): raw MODIS without any coefficient, and MODIS × the single world coefficient 4.04.

| Region | Bias | MAPE | World coefficient: bias / MAPE | Raw MODIS: bias / MAPE | Pearson r (harmonized / raw MODIS) | Months |
| --- | --- | --- | --- | --- | --- | --- |
| Northern Kazakhstan | −8.8 % | 19.9 % | +24.5 % / 30.3 % | −69.1 % / 73.9 % | 0.990 / 0.984 | 56 |
| Southern Amazon | −0.3 % | 16.3 % | +7.2 % / 38.2 % | −73.4 % / 69.2 % | 0.999 / 0.999 | 56 |
| Northern California | +4.2 % | 21.4 % | −6.2 % / 21.6 % | −76.7 % / 70.2 % | 0.999 / 0.999 | 56 |

**What the table shows and what it does not.** Pearson r is scale-free and follows the shared seasonal cycle, so raw MODIS
scores almost the same r as the harmonized series: r says that both sensors see the same fire seasons, not that the
coefficients are right. The coefficients show in bias and MAPE: in Kazakhstan and the Amazon the 1° coefficients cut the
error of the world coefficient by a third to a half; in Northern California they are about as good as the world coefficient.
The monthly error in a region is larger than the WAPE over 5° blocks: quiet months with tens of detections carry the same
weight in it. The sign of the bias differs between regions — the MODIS orbit drift affects latitudes and seasons unevenly.

**The 2012 seam.** The ratio of the 2012–2014 mean to the 2009–2011 mean worldwide: 0.97 in the unified series, 3.80 with a naive splice
(raw MODIS before the seam, raw Suomi NPP after).
Yearly totals, million detections in VIIRS equivalent: 2010 — 17.3; 2011 — 17.3; 2012 — 18.3; 2013 — 15.4.

**The 2026 seam.** On 2024–2025 (excluding outage months) worldwide: Σ(NOAA-20 × coefficient) / Σ Suomi NPP = 1.00,
without the coefficient — 0.98. The sensors are identical, so even a naive splice produces almost no step;
the NOAA-20 coefficient is fitted on the whole 2018–2025 overlap, so this check is not independent.

**The 2002 seam (Terra only → Terra + Aqua).** The series switches from Terra × "Terra only" coefficient to
(Terra + Aqua) × "Terra + Aqua" coefficient in August 2002. Where both satellites exist before Suomi NPP (2003–2011), the
two estimates can be compared on the same months: worldwide, Terra-only / Terra + Aqua = 0.972 (by year 0.955–0.990),
against 0.994 inside the fit window 2012–2020. So the Terra-only months (November 2000 – July 2002) are probably about 3 %
low relative to the rest of the series. This is inferred, not measured in 2000–2002, and small against the Terra-only
error; we do not correct for it.

## 7. Limitations

- Small fires that VIIRS (375 m) sees and MODIS (1 km) does not are recovered before 2012 only
  statistically: the coefficient carries over the average ratio, not individual events.
- In small areas (smaller than a 1° cell) the coefficient is taken from the cell or the 5° block — the estimate is coarser and the interval wider.
- 2000–2002: Terra only, one morning overpass — the error is 1.7–2.1 times higher than for Terra + Aqua, and the
  Terra-only months are probably about 3 % low (the 2002 seam above).
- One coefficient per cell for the whole year: the ratio changes with the season, so in the fit window the world forecast
  is 5 % too low to 8 % too high depending on the calendar month for Terra + Aqua (−8 % to +10 % for Terra only).
- Days when the lead satellite did not report are filled from another satellite where one exists. Terra gaps in 2000–2012
  and NOAA-20 gaps after Suomi NPP cannot be filled; those months carry `sensor_gap` and may be understated.
  Shorter partial dropouts (above a quarter or half of the normal count) are not detected.
- Active lava flows and gas flares: MODIS and VIIRS classify them differently, so such places are masked for all satellites
  and outlier cells take the coefficient of their 5° block. Detections left around them are less reliable — for example the
  Kilauea cell keeps a coefficient of 24 from 1 MODIS detection against 538 Suomi NPP detections in 2012–2020.
- The FIRMS MODIS archive switches from Collection 6 to Collection 6.1 in 2023. C6.1 changes the calibration, not the
  fire algorithm. The coefficients are fitted on C6 years (2012–2020); the 2021–2025 check runs on C6 in 2021–2022 and
  on C6.1 in 2023–2025.
- 2026: NRT data (from August) is preliminary and will be refined. NRT has no `type` field: permanent sources are removed
  with the same mask as the archive. It marks 6.9 % of Suomi NPP NRT detections as static sources against 8.5 % with
  standard processing — some industrial sources may remain in NRT.

## 8. Data source

NASA FIRMS — https://www.earthdata.nasa.gov/data/tools/firms
