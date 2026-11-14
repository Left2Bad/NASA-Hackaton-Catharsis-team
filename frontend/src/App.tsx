import { AppShell } from './components/AppShell';
import { useHashRoute } from './hooks/useHashRoute';
import { CalendarScreen } from './screens/CalendarScreen';
import { ScalesPage } from './screens/ScalesPage';

/** Корень приложения: шапка и текущий раздел по адресу после решётки. */
export default function App() {
  const route = useHashRoute();

  return (
    <AppShell route={route}>{route === '/scales' ? <ScalesPage /> : <CalendarScreen />}</AppShell>
  );
}
