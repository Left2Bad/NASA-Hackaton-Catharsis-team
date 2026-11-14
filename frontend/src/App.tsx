import { AppShell } from './components/AppShell';
import { useHashRoute } from './hooks/useHashRoute';
import { CalendarScreen } from './screens/CalendarScreen';
import { ScalesPage } from './screens/ScalesPage';

/** App root: the header and the section chosen by the address after the hash. */
export default function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>{route === '/scales' ? <ScalesPage /> : <CalendarScreen />}</AppShell>
  );
}
