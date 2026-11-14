import type { CSSProperties } from 'react';
import styles from './ScaleLegend.module.css';

interface ScaleLegendProps {
  /** What the color shows, with its unit. */
  title: string;
  /** Class colors from left to right. */
  colors: readonly string[];
  /** Labels of the boundaries between classes: one fewer than the colors. */
  boundaries: readonly string[];
  /** Labels under the ends of the scale, for example "below median" and "above median". */
  ends?: readonly [string, string];
  /** Separate keys outside the scale, for example "No fires". */
  extras?: readonly { color: string | null; label: string; hatched?: boolean }[];
  /** One short line under the scale on how to read it. */
  note?: string;
}

/**
 * Scale legend with numbers on the class boundaries (requirement F11).
 * The numbers are written as text, so color is never the only carrier of a value.
 */
export function ScaleLegend({
  title,
  colors,
  boundaries,
  ends,
  extras = [],
  note,
}: ScaleLegendProps) {
  const columns = { gridTemplateColumns: `repeat(${colors.length}, minmax(0, 1fr))` };
  // The scale needs room for one boundary label per class, so its width grows with the classes.
  const scaleWidth = { '--classes': colors.length } as CSSProperties;

  return (
    <figure className={styles.legend}>
      <figcaption className={styles.title}>{title}</figcaption>
      <div className={styles.body}>
        <div className={styles.scale} style={scaleWidth}>
          <div className={styles.swatches} style={columns} aria-hidden="true">
            {colors.map((color) => (
              <span key={color} style={{ background: color }} />
            ))}
          </div>
          {boundaries.length === colors.length - 1 && (
            <div className={styles.ticks} style={columns}>
              {boundaries.map((boundary, index) => (
                <span key={index} style={{ gridColumn: index + 2 }}>
                  {boundary}
                </span>
              ))}
            </div>
          )}
          {ends && (
            <div className={styles.ends}>
              <span>{ends[0]}</span>
              <span>{ends[1]}</span>
            </div>
          )}
        </div>
        {extras.length > 0 && (
          <ul className={styles.extras}>
            {extras.map((extra) => (
              <li key={extra.label}>
                <span
                  className={
                    extra.color
                      ? styles.key
                      : `${styles.key} ${extra.hatched ? styles.keyHatched : styles.keyEmpty}`
                  }
                  style={{ background: extra.color ?? undefined }}
                  aria-hidden="true"
                />
                {extra.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {note && <p className={styles.note}>{note}</p>}
    </figure>
  );
}
