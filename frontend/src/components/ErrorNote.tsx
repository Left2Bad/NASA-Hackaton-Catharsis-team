import { ApiError, isRetryable } from '../api/errors';
import { CLIENT_ERROR_LABELS, ERROR_LABELS } from '../labels';
import styles from './ErrorNote.module.css';

/** The text to show for a failed request. Every code gets the app's own wording. */
function messageFor(error: Error): { code: string; text: string } {
  if (!(error instanceof ApiError)) return { code: 'NETWORK', text: CLIENT_ERROR_LABELS.NETWORK };
  if (
    error.code === 'NETWORK' ||
    error.code === 'TIMEOUT' ||
    error.code === 'UNKNOWN' ||
    error.code === 'OFFLINE'
  ) {
    return { code: error.code, text: CLIENT_ERROR_LABELS[error.code] };
  }
  return { code: error.code, text: ERROR_LABELS[error.code] };
}

interface ErrorNoteProps {
  error: Error;
  /** Asks again. The button appears only for failures that asking again can fix. */
  onRetry?: () => void;
  /** True while the retry is under way: the button waits instead of firing twice. */
  retrying?: boolean;
}

/**
 * A request error, said in the interface's own words: what happened and what to do.
 * The error code stays on the element as `data-code` for tests and bug reports.
 */
export function ErrorNote({ error, onRetry, retrying = false }: ErrorNoteProps) {
  const { code, text } = messageFor(error);
  return (
    <div className={styles.error} role="alert" data-code={code}>
      <p>{text}</p>
      {onRetry && isRetryable(error) && (
        <button type="button" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Trying…' : 'Try again'}
        </button>
      )}
    </div>
  );
}
