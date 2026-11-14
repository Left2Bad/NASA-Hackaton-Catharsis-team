import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const currentRoute = () => window.location.hash.replace(/^#/, '') || '/';

/**
 * Текущий раздел приложения из адреса: `#/scales` → '/scales', без решётки → '/'.
 * Разделов мало, поэтому отдельная библиотека маршрутизации пока не нужна.
 */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, currentRoute);
}
