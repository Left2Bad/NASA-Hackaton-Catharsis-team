import type { ReactNode } from 'react';
import { calendarHref } from '../state/link';
import styles from './AppShell.module.css';
import { SnapshotBanner } from './SnapshotBanner';

const SECTIONS = [
  { route: '/', label: 'Calendar' },
  { route: '/method', label: 'Method' },
  { route: '/scales', label: 'Color scales' },
] as const;

/** Page shell: a header with the name and sections, and the section content below it. */
export function AppShell({ route, children }: { route: string; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="#/">
          Burn Calendar
        </a>
        <span className={styles.tagline}>One fire record from MODIS and VIIRS, 2000 to today</span>
        <nav className={styles.nav} aria-label="Sections">
          {SECTIONS.map((section) => (
            <a
              key={section.route}
              // The calendar link keeps the chosen area and period, so a visit to another
              // section does not lose them.
              href={section.route === '/' ? calendarHref() : `#${section.route}`}
              aria-current={route === section.route ? 'page' : undefined}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </header>
      <SnapshotBanner />
      {children}
    </div>
  );
}
