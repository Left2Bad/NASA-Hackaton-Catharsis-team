import { useEffect, useState } from 'react';

/**
 * Turns true once the component has been on screen for `delayMs`. A loading note uses it
 * to add a second sentence when the wait gets long, instead of leaving the user guessing.
 */
export function useSlow(delayMs: number): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return slow;
}
