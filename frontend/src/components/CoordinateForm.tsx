import { useId, useState, type FormEvent } from 'react';
import type { Geometry } from '../api/types';
import {
  areaFromBounds,
  areaFromCircle,
  MAX_RADIUS_KM,
  type AreaInputResult,
} from '../geo/coordinateInput';
import { boundsOf } from '../geo/geometry';
import styles from './CoordinateForm.module.css';

interface CoordinateFormProps {
  /** The current area, used to prefill the bounds. */
  geometry: Geometry | null;
  /** Called with a valid area when the form is submitted. */
  onSubmit: (geometry: Geometry) => void;
  onCancel: () => void;
}

type Mode = 'bounds' | 'circle';

interface Field {
  name: string;
  label: string;
  hint: string;
}

const BOUNDS_FIELDS: readonly Field[] = [
  { name: 'west', label: 'West', hint: 'longitude, −180 to 180' },
  { name: 'south', label: 'South', hint: 'latitude, −90 to 90' },
  { name: 'east', label: 'East', hint: 'longitude, −180 to 180' },
  { name: 'north', label: 'North', hint: 'latitude, −90 to 90' },
];

const CIRCLE_FIELDS: readonly Field[] = [
  { name: 'latitude', label: 'Latitude', hint: '−90 to 90' },
  { name: 'longitude', label: 'Longitude', hint: '−180 to 180' },
  { name: 'radiusKm', label: 'Radius, km', hint: `1 to ${MAX_RADIUS_KM}` },
];

function initialValues(geometry: Geometry | null): Record<string, string> {
  const empty = { latitude: '', longitude: '', radiusKm: '' };
  if (!geometry) return { west: '', south: '', east: '', north: '', ...empty };
  const { west, south, east, north } = boundsOf(geometry);
  return {
    west: String(west),
    south: String(south),
    east: String(east),
    north: String(north),
    ...empty,
  };
}

/**
 * Sets the area by numbers instead of drawing: either four bounds or a point with a radius
 * (requirement F2). It is also the keyboard alternative to drawing on the map.
 */
export function CoordinateForm({ geometry, onSubmit, onCancel }: CoordinateFormProps) {
  const formId = useId();
  const [mode, setMode] = useState<Mode>('bounds');
  const [values, setValues] = useState(() => initialValues(geometry));
  const [problem, setProblem] = useState<Extract<AreaInputResult, { ok: false }> | null>(null);

  const fields = mode === 'bounds' ? BOUNDS_FIELDS : CIRCLE_FIELDS;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result =
      mode === 'bounds'
        ? areaFromBounds({
            west: values.west,
            south: values.south,
            east: values.east,
            north: values.north,
          })
        : areaFromCircle({
            latitude: values.latitude,
            longitude: values.longitude,
            radiusKm: values.radiusKm,
          });

    if (result.ok) {
      setProblem(null);
      onSubmit(result.geometry);
      return;
    }
    setProblem(result);
    // Move focus to the field that needs fixing.
    document.getElementById(`${formId}-${result.field}`)?.focus();
  };

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      aria-label="Area by coordinates"
      noValidate
    >
      <fieldset className={styles.modes}>
        <legend>Set the area by</legend>
        <label>
          <input
            type="radio"
            name={`${formId}-mode`}
            checked={mode === 'bounds'}
            onChange={() => {
              setMode('bounds');
              setProblem(null);
            }}
          />
          Bounds
        </label>
        <label>
          <input
            type="radio"
            name={`${formId}-mode`}
            checked={mode === 'circle'}
            onChange={() => {
              setMode('circle');
              setProblem(null);
            }}
          />
          Point and radius
        </label>
      </fieldset>

      <div className={styles.fields}>
        {fields.map((field) => {
          const id = `${formId}-${field.name}`;
          const invalid = problem?.field === field.name;
          return (
            <div key={field.name} className={styles.field}>
              <label htmlFor={id}>{field.label}</label>
              <input
                id={id}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values[field.name]}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${formId}-problem` : `${id}-hint`}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              />
              <span id={`${id}-hint`} className={styles.hint}>
                {field.hint}
              </span>
            </div>
          );
        })}
      </div>

      {problem && (
        <p id={`${formId}-problem`} className={styles.problem} role="alert">
          {problem.message}
        </p>
      )}

      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>
          Show area
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
