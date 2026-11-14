import type { ReactNode } from 'react';
import { useSlow } from '../hooks/useSlow';
import styles from './LoadingNote.module.css';

/** After this long the note explains the wait. The mocks answer much sooner. */
export const SLOW_AFTER_MS = 4000;

interface LoadingNoteProps {
  /** What is loading: "Loading the calendar…". */
  children: ReactNode;
  /** A second sentence for a long wait. Without it the note never changes. */
  slowHint?: string;
}

/**
 * A request in progress. The text is announced to screen readers; the spinner is decoration.
 * When the answer takes long, the hint says that the app is still working and why.
 */
export function LoadingNote({ children, slowHint }: LoadingNoteProps) {
  const slow = useSlow(SLOW_AFTER_MS);
  return (
    <p className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <span>
        {children}
        {slow && slowHint ? ` ${slowHint}` : ''}
      </span>
    </p>
  );
}
