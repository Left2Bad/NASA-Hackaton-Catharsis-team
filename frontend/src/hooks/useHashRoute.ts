import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

// The state of a screen may follow the section after `?`; it is not part of the route.
const currentRoute = () => window.location.hash.replace(/^#/, '').split('?')[0] || '/';

/**
 * The current section from the address: `#/scales` gives '/scales', `#/?area=x` and no hash give '/'.
 * There are few sections, so a routing library is not needed yet.
 */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, currentRoute);
}
