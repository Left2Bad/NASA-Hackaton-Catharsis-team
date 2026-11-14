import { lazy, Suspense } from 'react';
import { AppShell } from './components/AppShell';
import { LoadingNote } from './components/LoadingNote';
import { useHashRoute } from './hooks/useHashRoute';
import { CalendarScreen } from './screens/CalendarScreen';
import { ScalesPage } from './screens/ScalesPage';

// The "Method" page brings the Markdown renderer and the method text with it, so it is
// loaded only when it is opened and the calendar starts without that weight.
const MethodPage = lazy(() => import('./screens/MethodPage'));

/** App root: the header and the section chosen by the address after the hash. */
export default function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>
      {route === '/method' ? (
        <Suspense
          fallback={
            <main style={{ flex: 1, padding: 'var(--space-5)' }}>
              <LoadingNote>Loading the page…</LoadingNote>
            </main>
          }
        >
          <MethodPage />
        </Suspense>
      ) : route === '/scales' ? (
        <ScalesPage />
      ) : (
        <CalendarScreen />
      )}
    </AppShell>
  );
}
