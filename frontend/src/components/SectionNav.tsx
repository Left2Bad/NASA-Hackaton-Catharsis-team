import styles from './SectionNav.module.css';

/** A section of the panel the reader can jump to: the `id` of its heading and a short name. */
export interface PanelSection {
  id: string;
  label: string;
}

/**
 * Jump links to the sections of the panel. The panel is several screens long, and a
 * reader who came for one figure should not have to scroll past the others to find it.
 * The links stay at the top of the panel while it scrolls.
 */
export function SectionNav({ sections }: { sections: readonly PanelSection[] }) {
  if (sections.length < 2) return null;

  const jump = (id: string) => {
    const heading = document.getElementById(id);
    if (!heading) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    heading.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <nav className={styles.nav} aria-label="Sections of the panel">
      {sections.map((section) => (
        <button key={section.id} type="button" onClick={() => jump(section.id)}>
          {section.label}
        </button>
      ))}
    </nav>
  );
}
