import { useMemo, useState } from 'react';
import methodology from '../../../docs/methodology.md?raw';
import { useMeta, useRawCalendar, useValidation } from '../api/queries';
import type { Meta } from '../api/types';
import { ErrorNote } from '../components/ErrorNote';
import { LineChart } from '../components/LineChart';
import { LoadingNote } from '../components/LoadingNote';
import { formatNumber, formatSignedPercent, presetLabel, SOURCE_LABELS } from '../labels';
import { methodologyHtml } from '../method/markdown';
import {
  regionName,
  seamLabel,
  validationPositions,
  validationTicks,
  yearlySensors,
  type ValidationRegion,
  type ValidationResponse,
} from '../method/series';
import styles from './MethodPage.module.css';

// The "Method" page (requirement F25): what harmonization does, the checks behind it,
// the limitations, and the acknowledgment of NASA FIRMS.
//
// The charts are drawn from the API (`/method/validation`, `/calendar` with `series=raw`).
// The detailed text is docs/methodology.md, written by the developer of the method and
// shown as it is, so the page and the document cannot drift apart.

const REPOSITORY = 'https://github.com/Left2Bad/NASA-Hackaton-Catharsis-team';
const FIRMS_URL = 'https://www.earthdata.nasa.gov/data/tools/firms';

/** What the raw sensors saw next to the harmonized record, for one example area. */
function BeforeAfter({ meta }: { meta: Meta }) {
  const [presetId, setPresetId] = useState(meta.presets[0]?.id ?? '');
  const preset = meta.presets.find((item) => item.id === presetId) ?? meta.presets[0];
  const calendar = useRawCalendar(preset?.geometry ?? null);
  const years = useMemo(() => (calendar.data ? yearlySensors(calendar.data) : []), [calendar.data]);

  if (!preset) return null;

  return (
    <div className={styles.block}>
      <p className={styles.control}>
        <label htmlFor="method-area">Area</label>
        <select
          id="method-area"
          value={preset.id}
          onChange={(event) => setPresetId(event.target.value)}
        >
          {meta.presets.map((item) => (
            <option key={item.id} value={item.id}>
              {presetLabel(item).name}
            </option>
          ))}
        </select>
      </p>
      {calendar.isPending && <LoadingNote>Loading the sensor records…</LoadingNote>}
      {calendar.isError && (
        <ErrorNote
          error={calendar.error}
          onRetry={() => void calendar.refetch()}
          retrying={calendar.isFetching}
        />
      )}
      {calendar.data && (
        <LineChart
          caption={`Fire detections per year, ${presetLabel(preset).name}`}
          positions={years.map((year) => String(year.year))}
          ticks={years.flatMap((year, index) =>
            year.year % 5 === 0 ? [{ index, label: String(year.year) }] : [],
          )}
          positionName="Year"
          series={[
            {
              id: 'harmonized',
              label: 'Harmonized record',
              color: '--series-main',
              values: years.map((year) => year.harmonized),
            },
            {
              id: 'modis',
              label: 'MODIS as recorded',
              color: '--series-blue',
              dashed: true,
              values: years.map((year) => year.modis),
            },
            {
              id: 'viirs',
              label: 'VIIRS Suomi NPP as recorded',
              color: '--series-purple',
              dashed: true,
              values: years.map((year) => year.viirs),
            },
          ]}
          note="Complete years only. A sensor is drawn for a year when it has all twelve months."
        />
      )}
    </div>
  );
}

/** One region of the check: the forecast from MODIS against what VIIRS really saw. */
function RegionCheck({ region }: { region: ValidationRegion }) {
  const { metrics } = region;
  return (
    <div className={styles.region}>
      <h3>{regionName(region)}</h3>
      <dl className={styles.metrics}>
        <div>
          <dt>Correlation</dt>
          <dd>{metrics.pearson_r.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Bias</dt>
          <dd>{formatSignedPercent(metrics.bias_pct)}</dd>
        </div>
        <div>
          <dt>Median monthly error</dt>
          <dd>{formatNumber(metrics.mape_pct)} %</dd>
        </div>
        <div>
          <dt>Months compared</dt>
          <dd>{metrics.n_months}</dd>
        </div>
      </dl>
      <LineChart
        caption={`Fire detections per month, ${regionName(region)}`}
        positions={validationPositions(region)}
        ticks={validationTicks(region)}
        positionName="Month"
        series={[
          {
            id: 'actual',
            label: 'VIIRS, actual',
            color: '--series-purple',
            dashed: true,
            values: region.series.map((point) => point.viirs_raw),
          },
          {
            id: 'forecast',
            label: 'Forecast from MODIS',
            color: '--series-main',
            values: region.series.map((point) => point.harmonized),
          },
          {
            id: 'modis',
            label: 'MODIS as recorded',
            color: '--series-blue',
            dashed: true,
            values: region.series.map((point) => point.modis_raw),
          },
        ]}
      />
    </div>
  );
}

function Checks({ validation }: { validation: ValidationResponse }) {
  const { calibration_period: fit, test_period: test } = validation;
  return (
    <>
      <p>
        The conversion is fitted on {fit.start_year} to {fit.end_year}. For {test.start_year} to{' '}
        {test.end_year}, years it has never seen, VIIRS is predicted from MODIS alone and compared
        with what VIIRS really recorded.
      </p>
      {validation.regions.map((region) => (
        <RegionCheck key={region.id} region={region} />
      ))}

      <h3>The seams of the record</h3>
      <p>
        Where one sensor hands over to another, the mean after the seam is divided by the mean
        before it. A ratio of 1 means no step. The naive splice simply joins the raw records.
      </p>
      <div className={styles.tableScroll}>
        <table className={styles.seams}>
          <thead>
            <tr>
              <th scope="col">Seam</th>
              <th scope="col">Harmonized</th>
              <th scope="col">Naive splice</th>
            </tr>
          </thead>
          <tbody>
            {validation.seams.map((seam) => (
              <tr key={seam.id}>
                <th scope="row">{seamLabel(seam)}</th>
                <td>{seam.ratio_harmonized.toFixed(2)}</td>
                <td>{seam.ratio_naive.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Which sensor leads the record in which years, from the dataset itself. */
function Sources({ meta }: { meta: Meta }) {
  return (
    <ol className={styles.sources}>
      {meta.sources.map((source) => (
        <li key={source.id}>
          <strong>{SOURCE_LABELS[source.id]}</strong>
          <span>
            {source.start} to {source.end ?? 'now'}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function MethodPage() {
  const meta = useMeta();
  const validation = useValidation();
  const details = useMemo(() => methodologyHtml(methodology), []);

  return (
    <main className={styles.scroller}>
      <div className={styles.page}>
        <h1>How the record is made</h1>
        <p className={styles.lead}>
          MODIS has watched fires from space since 2000, VIIRS since 2012. VIIRS has finer pixels
          and sees several times more fires, so the two records cannot simply be joined: activity
          would seem to jump in 2012. Burn Calendar converts the earlier sensors to the scale of
          VIIRS Suomi NPP, cell by cell, and checks the result on years the conversion has never
          seen.
        </p>

        <section aria-labelledby="method-effect">
          <h2 id="method-effect">What harmonization changes</h2>
          <p>
            The dashed lines are the sensors as they recorded. The solid line is the record the
            calendar uses: MODIS converted to the VIIRS scale before 2012, VIIRS itself after it.
          </p>
          {meta.isPending && <LoadingNote>Loading the dataset…</LoadingNote>}
          {meta.isError && (
            <ErrorNote
              error={meta.error}
              onRetry={() => void meta.refetch()}
              retrying={meta.isFetching}
            />
          )}
          {meta.data && <BeforeAfter meta={meta.data} />}
        </section>

        <section aria-labelledby="method-checks">
          <h2 id="method-checks">How it was checked</h2>
          {validation.isPending && <LoadingNote>Loading the checks…</LoadingNote>}
          {validation.isError && (
            <ErrorNote
              error={validation.error}
              onRetry={() => void validation.refetch()}
              retrying={validation.isFetching}
            />
          )}
          {validation.data && <Checks validation={validation.data} />}
        </section>

        {meta.data && (
          <section aria-labelledby="method-sources">
            <h2 id="method-sources">Which sensor leads the record</h2>
            <Sources meta={meta.data} />
          </section>
        )}

        {validation.data && validation.data.limitations.length > 0 && (
          <section aria-labelledby="method-limits">
            <h2 id="method-limits">What the record cannot do</h2>
            <ul>
              {validation.data.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="method-details">
          <h2 id="method-details">The method in detail</h2>
          <p>
            The full description by the developer of the method, from{' '}
            <a
              href={`${REPOSITORY}/blob/main/docs/methodology.md`}
              target="_blank"
              rel="noreferrer"
            >
              docs/methodology.md
            </a>{' '}
            in the project repository.
          </p>
          {/* The HTML comes from a file of this repository, not from a user or a server. */}
          <div className={styles.prose} dangerouslySetInnerHTML={{ __html: details }} />
        </section>

        <section aria-labelledby="method-thanks">
          <h2 id="method-thanks">Data and acknowledgment</h2>
          <p>
            We acknowledge the use of data from NASA&apos;s Fire Information for Resource Management
            System (FIRMS),{' '}
            <a href={FIRMS_URL} target="_blank" rel="noreferrer">
              earthdata.nasa.gov/data/tools/firms
            </a>
            , part of NASA&apos;s Earth Science Data and Information System (ESDIS).
          </p>
          <p>
            Active fire detections: MODIS Collection 6.1 (Terra and Aqua), VIIRS 375 m Suomi NPP and
            VIIRS 375 m NOAA-20.
            {meta.data && ` Data version ${meta.data.data_version}.`}
          </p>
        </section>
      </div>
    </main>
  );
}
