import { ApiError } from '../api/errors';
import styles from './ErrorNote.module.css';

/** A request error message: the contract code and the server text. */
export function ErrorNote({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.code : 'NETWORK';
  return (
    <p className={styles.error} role="alert">
      <strong>{code}</strong> {error.message}
    </p>
  );
}
