import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const currentRoute = () => window.location.hash.replace(/^#/, '') || '/';

/**
 * The current section from the address: `#/scales` gives '/scales', no hash gives '/'.
 * There are few sections, so a routing library is not needed yet.
 */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, currentRoute);
}
