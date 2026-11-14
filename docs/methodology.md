# MODIS and VIIRS harmonization method

Russian version: [methodology.ru.md](methodology.ru.md)

> Owner: developer A. This text goes to the "Method" page of the app and into the presentation.
> Code: `pipeline/`. The numbers below come from `data/harmonized/summary.json`.

## 1. Task

Merge the MODIS records (since November 2000) and the VIIRS records (since January 2012) into one consistent series,
expressed in "VIIRS Suomi NPP equivalent".

## 2. Data

NASA FIRMS, yearly "Country Yearly Summary" archives (all countries), standard processing:

| Sensor | Years | Detections per year |
| --- | --- | --- |
| MODIS Collection 6.1 (Terra, Aqua) | 2000-11 – 2025 | ~2.5–4.5 million |
| VIIRS 375 m, Suomi NPP | 2012-01-20 – 2025 | ~19–21 million |
| VIIRS 375 m, NOAA-20 | 2018-04 – 2025 | ~18–21 million |

2026 (up to 14 November) comes through the FIRMS Area API: standard-processing VIIRS up to 31 July (MODIS up to 31 August),
and near-real-time (NRT) data after that. Suomi NPP delivers data up to 2 November 2026. In total, 2026 has 35.6 million detections.

## 3. Preparation

- A single schema for all sensors (`pipeline/to_parquet.py`): coordinates, date/time, satellite, confidence class,
  brightness temperatures, FRP, day/night, type, country.
- Confidence: MODIS has a number 0–100, which we convert to a class (< 30 — low, 30–79 — nominal, ≥ 80 — high);
  VIIRS already has an l/n/h class. Low-confidence detections are dropped.
- Source type: we keep only `type = 0` (probable vegetation fire). Volcanoes (1),
  static sources — gas flares, factories (2) — and offshore objects (3) are dropped.
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
and the block towards the world value. This way empty cells get no noisy coefficients.

Six sets: {detection count, FRP} × {MODIS Terra + Aqua, Terra only, NOAA-20}. World coefficients:

| Set | Detection count | FRP | Fitting period |
| --- | --- | --- | --- |
| MODIS Terra + Aqua → Suomi NPP | **4.07** | 0.90 | 2012-02 – 2020-12 |
| MODIS Terra only → Suomi NPP | **12.1** | 2.90 | 2012-02 – 2020-12 |
| NOAA-20 → Suomi NPP | **1.016** | 1.020 | 2018-04 – 2025-12 |

**Why the MODIS coefficients are fitted on 2012–2020 only.** Around 2020–2022 Terra and Aqua stopped
holding their nominal orbits: the Terra overpass drifts to earlier in the morning, the Aqua overpass to later in the day.
The Suomi NPP / Terra ratio stayed at 12.1–12.5 in 2012–2021 and rose to 13.5 (2022), 14.1 (2024) and 16.5 (2025);
the share of Terra among MODIS detections fell from 0.50 to 0.37. Historical MODIS (2000–2012), to which the coefficients are applied,
flew in nominal orbits — so the coefficients should be fitted on nominal-orbit years.

## 5. Series assembly

The rule for choosing the lead source is a single function, `pipeline/lead.py`, used by both the pipeline and the backend.

| Period | Lead source | Transformation |
| --- | --- | --- |
| November 2000 – July 2002 | MODIS Terra | × "Terra only" coefficient |
| August 2002 – January 2012 | MODIS Terra + Aqua | × "Terra + Aqua" coefficient |
| February 2012 – October 2026 | VIIRS Suomi NPP | none (reference) |
| Suomi NPP outage months: 2022-07, 2022-08, 2024-07, 2024-11, 2026-07 | VIIRS NOAA-20 | × NOAA-20 → Suomi NPP coefficient |
| from November 2026 | VIIRS NOAA-20 | × NOAA-20 → Suomi NPP coefficient |

- Aqua data starts on 4 July 2002; July 2002 is kept with Terra so that the period starts with a full month.
- February 2012 is complete for Suomi NPP: 4.36 S-NPP detections per MODIS detection against a median of 4.13 (January is incomplete, data starts on the 20th).
- Outage months are found automatically: the world-wide Suomi NPP / NOAA-20 ratio is below 85 % of the median
  (for example, 2024-07: 0.57 — the satellite was in safe mode). The list is in `data/outage_months.csv`.

## 6. Quality checks

Coefficients are fitted on some years, and on other years VIIRS Suomi NPP is predicted from the other sensor;
the comparison is over "5° block × month" pairs. WAPE is the weighted error Σ|forecast − actual| / Σactual.

**Main check (as in the API contract): fitted on 2012–2020, tested on 2021–2025.**

| Set | Pearson r | WAPE | Bias | r / WAPE with a single world coefficient |
| --- | --- | --- | --- | --- |
| Detections, Terra + Aqua | 0.990 | 14.6 % | −4.3 % | 0.979 / 20.5 % |
| Detections, Terra only | 0.948 | 27.5 % | −14.1 % | 0.883 / 42.8 % |
| Detections, NOAA-20 | 0.998 | 5.9 % | +1.1 % | 0.999 / 5.3 % |
| FRP, Terra + Aqua | 0.975 | 18.5 % | −3.2 % | 0.925 / 31.6 % |
| FRP, NOAA-20 | 0.996 | 8.4 % | +1.9 % | 0.998 / 7.1 % |

The MODIS bias over 2021–2025 is a consequence of the orbit drift (section 4), not of a method error.

**Check on nominal orbits: fitted on 2012–2016, tested on 2017–2020** — it shows the accuracy where
the coefficients are actually applied (2000–2012):

| Set | Pearson r | WAPE | Bias | r / WAPE with a single world coefficient |
| --- | --- | --- | --- | --- |
| Detections, Terra + Aqua | 0.992 | 13.1 % | −2.1 % | 0.981 / 20.4 % |
| Detections, Terra only | 0.977 | 21.4 % | +1.5 % | 0.931 / 38.7 % |
| FRP, Terra + Aqua | 0.981 | 15.9 % | +2.2 % | 0.957 / 27.9 % |
| FRP, Terra only | 0.942 | 31.1 % | +7.9 % | 0.778 / 61.4 % |

The spatial coefficients reduce the MODIS error by a third to a half compared with a single world coefficient.
For NOAA-20 the world coefficient is already almost exact (the sensors are identical), and the spatial one adds nothing.

**`low`/`high` intervals.** On the pairs from the checks we compute the 10 % and 90 % quantiles of the "actual / forecast" ratio,
separately by forecast magnitude (bins `floor(log10(value + 1) · 2)`): for MODIS from the nominal-orbit check,
for NOAA-20 from the main one. Example for Terra + Aqua: at a forecast of ~10 detections per month the interval is ×0.40…×4.0,
at ~10,000 it is ×0.85…×1.23. The table is `data/uncertainty.parquet`; for Suomi NPP the interval is zero.

**Three regions** (`pipeline/validation.py` → `data/validation/report.json`, served by `/method/validation`).
Forecast — MODIS Terra + Aqua × the 1° cell coefficient (fitted on 2012–2020), actual — Suomi NPP, 2021–2025 by month.
Suomi NPP outage months stay in the series but do not take part in the metrics: the "actual" itself is understated there.
MAPE is the median monthly error |forecast − actual| / actual over months with actual > 0.

| Region | Pearson r | Bias | MAPE | Months |
| --- | --- | --- | --- | --- |
| Northern Kazakhstan | 0.982 | −12.8 % | 22.3 % | 56 |
| Southern Amazon | 0.999 | +1.3 % | 18.1 % | 56 |
| Northern California | 0.999 | +5.3 % | 23.2 % | 56 |

The monthly error in a region is larger than the WAPE over 5° blocks: quiet months with tens of detections carry the same weight in it.
The sign of the bias differs between regions — the MODIS orbit drift affects latitudes and seasons unevenly.

**The 2012 seam.** The ratio of the 2012–2014 mean to the 2009–2011 mean worldwide: 0.97 in the unified series, 3.84 with a naive splice
(raw MODIS before the seam, raw Suomi NPP after).
Yearly totals, million detections in VIIRS equivalent: 2010 — 17.7; 2011 — 17.6; 2012 — 18.4; 2013 — 15.7.

**The 2026 seam.** On 2024–2025 (excluding outage months) worldwide: Σ(NOAA-20 × coefficient) / Σ Suomi NPP = 1.01,
without the coefficient — 1.00. The sensors are identical, so even a naive splice produces almost no step;
the NOAA-20 coefficient is fitted on the whole 2018–2025 overlap, so this check is not independent.

## 7. Limitations

- Small fires that VIIRS (375 m) sees and MODIS (1 km) does not are recovered before 2012 only
  statistically: the coefficient carries over the average ratio, not individual events.
- In small areas (smaller than a 1° cell) the coefficient is taken from the cell or the 5° block — the estimate is coarser and the interval wider.
- 2000–2002: Terra only, one morning overpass — the error is roughly one and a half times higher than for Terra + Aqua.
- Satellite outages outside the detected outage months look like periods of low activity.
- 2026: NRT data (from August) is preliminary and will be refined. NRT has no `type` field: permanent sources are removed
  with a mask from the 2012–2025 archive (~1 km cells where types 1–3 occurred). The mask removes 6.8 % of VIIRS NRT detections against 8.5 % with
  standard processing — some industrial sources may remain in NRT.

## 8. Data source

NASA FIRMS — https://www.earthdata.nasa.gov/data/tools/firms
