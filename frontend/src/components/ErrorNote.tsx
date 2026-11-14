import { ApiError } from '../api/errors';
import styles from './ErrorNote.module.css';

/** Сообщение об ошибке запроса: код из контракта и текст сервера. */
export function ErrorNote({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.code : 'NETWORK';
  return (
    <p className={styles.error} role="alert">
      <strong>{code}</strong> {error.message}
    </p>
  );
}
