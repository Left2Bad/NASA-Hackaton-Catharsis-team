import { useState } from 'react';
import { API_BASE_URL, USE_MOCKS } from './api/config';
import { ApiError } from './api/errors';
import { useCalendar, useMeta } from './api/queries';
import type { CalendarResponse, Meta, Preset } from './api/types';

// Страница-каркас (задача B2): показывает, что типы из контракта, клиент API и моки
// работают вместе. Настоящий экран «карта + панель» появится в задачах B3–B9.

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

const monthName = (month: number) => monthFormat.format(new Date(Date.UTC(2001, month - 1, 1)));

function ErrorNote({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.code : 'NETWORK';
  return (
    <p className="note note-error" role="alert">
      <strong>{code}</strong> — {error.message}
    </p>
  );
}

function DatasetSection({ meta }: { meta: Meta }) {
  return (
    <section aria-labelledby="dataset-heading">
      <h2 id="dataset-heading">Dataset</h2>
      <dl className="facts">
        <div>
          <dt>Data version</dt>
          <dd>{meta.data_version}</dd>
        </div>
        <div>
          <dt>Date range</dt>
          <dd>
            {meta.first_date} — {meta.last_date}
          </dd>
        </div>
        <div>
          <dt>Standard processing through</dt>
          <dd>{meta.last_standard_date}</dd>
        </div>
        <div>
          <dt>Grid step</dt>
          <dd>{meta.grid_deg}°</dd>
        </div>
      </dl>

      <h3>Lead source by period</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
          </tr>
        </thead>
        <tbody>
          {meta.sources.map((source) => (
            <tr key={source.id}>
              <th scope="row">{source.label}</th>
              <td>{source.start}</td>
              <td>{source.end ?? 'now'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CalendarSummary({ calendar }: { calendar: CalendarResponse }) {
  const { summary } = calendar;
  return (
    <>
      <dl className="facts">
        <div>
          <dt>Area</dt>
          <dd>{numberFormat.format(calendar.area_km2)} km²</dd>
        </div>
        <div>
          <dt>Months in series</dt>
          <dd>{calendar.months.length}</dd>
        </div>
        <div>
          <dt>Most active year</dt>
          <dd>{summary.peak_year ?? '—'}</dd>
        </div>
        <div>
          <dt>Peak month</dt>
          <dd>{summary.peak_month === null ? '—' : monthName(summary.peak_month)}</dd>
        </div>
        <div>
          <dt>Total for period</dt>
          <dd>{numberFormat.format(summary.total)}</dd>
        </div>
        <div>
          <dt>Trend per decade</dt>
          <dd>
            {summary.trend_pct_per_decade === null
              ? '—'
              : `${numberFormat.format(summary.trend_pct_per_decade)} %`}
          </dd>
        </div>
      </dl>
      {calendar.warnings.map((warning) => (
        <p className="note" key={warning.code}>
          <strong>{warning.code}</strong> — {warning.message}
        </p>
      ))}
    </>
  );
}

function PresetsSection({ presets }: { presets: Preset[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = presets.find((preset) => preset.id === selectedId) ?? presets[0];
  const calendar = useCalendar(selected ? { geometry: selected.geometry } : null);

  if (!selected) {
    return <p className="note">The API returned no example areas.</p>;
  }

  return (
    <section aria-labelledby="presets-heading">
      <h2 id="presets-heading">Example areas</h2>
      <div className="presets" role="group" aria-label="Example areas">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={preset.id === selected.id}
            onClick={() => setSelectedId(preset.id)}
          >
            {preset.name}
          </button>
        ))}
      </div>
      {selected.description && <p className="muted">{selected.description}</p>}

      <h3>Calendar summary</h3>
      {calendar.isPending && <p role="status">Loading calendar…</p>}
      {calendar.isError && <ErrorNote error={calendar.error} />}
      {calendar.data && <CalendarSummary calendar={calendar.data} />}
    </section>
  );
}

export default function App() {
  const meta = useMeta();

  return (
    <main className="page">
      <header>
        <h1>Burn Calendar</h1>
        <p className="muted">Fire activity on a harmonized MODIS + VIIRS record</p>
        <p className="note">
          {USE_MOCKS ? (
            <>
              <strong>Mock mode.</strong> Responses come from <code>contract/examples</code>:
              synthetic numbers, the same for every area.
            </>
          ) : (
            <>
              <strong>Live API:</strong> <code>{API_BASE_URL}</code>
            </>
          )}
        </p>
      </header>

      {meta.isPending && <p role="status">Loading dataset metadata…</p>}
      {meta.isError && <ErrorNote error={meta.error} />}
      {meta.data && (
        <>
          <DatasetSection meta={meta.data} />
          <PresetsSection presets={meta.data.presets} />
        </>
      )}

      <footer className="muted">
        We acknowledge the use of data from NASA&apos;s Fire Information for Resource Management
        System (FIRMS), part of NASA&apos;s Earth Science Data and Information System (ESDIS).
      </footer>
    </main>
  );
}
