import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

const SECTIONS = [
  { route: '/', label: 'Calendar' },
  { route: '/scales', label: 'Color scales' },
] as const;

/** Каркас страницы: шапка с названием и разделами, под ней содержимое раздела. */
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
              href={`#${section.route}`}
              aria-current={route === section.route ? 'page' : undefined}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
