import { ApiError } from '../api/errors';
import { ERROR_LABELS } from '../labels';
import styles from './ErrorNote.module.css';

const NETWORK_MESSAGE = 'The server cannot be reached. Check the connection and try again.';

/** The text to show for a failed request. Known error codes get the app's own wording. */
function messageFor(error: Error): { code: string; text: string } {
  if (!(error instanceof ApiError)) return { code: 'NETWORK', text: NETWORK_MESSAGE };
  if (error.code === 'UNKNOWN') return { code: error.code, text: error.message };
  return { code: error.code, text: ERROR_LABELS[error.code] };
}

/**
 * A request error, said in the interface's own words: what happened and what to do.
 * The contract code stays on the element as `data-code` for tests and bug reports.
 */
export function ErrorNote({ error }: { error: Error }) {
  const { code, text } = messageFor(error);
  return (
    <p className={styles.error} role="alert" data-code={code}>
      {text}
    </p>
  );
}
