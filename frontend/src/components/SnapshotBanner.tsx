import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FALLBACK_MODE, retryServer, snapshot, useSnapshotActive } from '../api/snapshot';
import styles from './SnapshotBanner.module.css';

/**
 * A strip under the header while the app shows saved answers instead of the server's.
 * It says so plainly, with the date of the snapshot, and offers to ask the server again
 * (unless the app was built to run on the snapshot alone).
 */
export function SnapshotBanner() {
  const active = useSnapshotActive();
  const queryClient = useQueryClient();
  const index = useQuery({
    queryKey: ['snapshot-index'],
    queryFn: ({ signal }) => snapshot.index(signal),
    enabled: active,
    staleTime: Infinity,
    retry: false,
  });

  if (!active) return null;

  const saved = index.data ? ` saved on ${index.data.created_at.slice(0, 10)}` : '';
  return (
    <div className={styles.banner} role="status">
      <p>
        <strong>Saved demo data.</strong>{' '}
        {FALLBACK_MODE === 'only'
          ? `This copy of the app runs on answers of the real API${saved}.`
          : `The server cannot be reached, so the app shows answers of the real API${saved}.`}{' '}
        Only the example areas are available.
      </p>
      {FALLBACK_MODE !== 'only' && (
        // Every answer on screen is asked again; those the server gives replace the saved ones.
        <button
          type="button"
          onClick={() => {
            retryServer();
            void queryClient.invalidateQueries();
          }}
        >
          Try the server again
        </button>
      )}
    </div>
  );
}
