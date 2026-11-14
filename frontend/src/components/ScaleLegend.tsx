import styles from './ScaleLegend.module.css';

interface ScaleLegendProps {
  /** Что показывает цвет, вместе с единицей измерения. */
  title: string;
  /** Цвета классов слева направо. */
  colors: readonly string[];
  /** Подписи границ между классами: на одну меньше, чем цветов. */
  boundaries: readonly string[];
  /** Подписи под краями шкалы, например «below median» и «above median». */
  ends?: readonly [string, string];
  /** Отдельные обозначения вне шкалы, например «нет пожаров». */
  extras?: readonly { color: string | null; label: string }[];
}

/**
 * Легенда шкалы с числами на границах классов (требование F11).
 * Числа продублированы текстом, так что цвет — не единственный носитель значения.
 */
export function ScaleLegend({ title, colors, boundaries, ends, extras = [] }: ScaleLegendProps) {
  const columns = { gridTemplateColumns: `repeat(${colors.length}, minmax(0, 1fr))` };

  return (
    <figure className={styles.legend}>
      <figcaption className={styles.title}>{title}</figcaption>
      <div className={styles.body}>
        <div className={styles.scale}>
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
                  className={extra.color ? styles.key : `${styles.key} ${styles.keyEmpty}`}
                  style={{ background: extra.color ?? undefined }}
                  aria-hidden="true"
                />
                {extra.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </figure>
  );
}
