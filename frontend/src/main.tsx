import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geologica';
import { createQueryClient } from './api/queryClient';
import App from './App';
import './index.css';

/** Starts the mocks before the first request. A build without mocks drops this code entirely. */
async function enableMocking(): Promise<void> {
  if (__API_MOCKS__) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledFrame: 'bypass' });
  }
}

const queryClient = createQueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

void enableMocking().then(() => {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
});
