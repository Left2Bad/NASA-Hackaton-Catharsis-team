import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { describe, expect, it } from 'vitest';
import calendarExample from '../../contract/examples/calendar.response.json';
import metaExample from '../../contract/examples/meta.json';
import App from './App';
import { server } from './mocks/server';

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe('страница-каркас на моках', () => {
  it('показывает метаданные набора данных из /meta', async () => {
    renderApp();

    expect(await screen.findByText(metaExample.data_version)).toBeInTheDocument();
    for (const source of metaExample.sources) {
      expect(screen.getByRole('rowheader', { name: source.label })).toBeInTheDocument();
    }
  });

  it('показывает области-примеры и сводку календаря из /calendar', async () => {
    renderApp();

    const presets = await screen.findByRole('group', { name: 'Example areas' });
    expect(within(presets).getAllByRole('button')).toHaveLength(metaExample.presets.length);

    const peakYear = String(calendarExample.summary.peak_year);
    expect(await screen.findByText(peakYear)).toBeInTheDocument();
  });

  it('переключает область по нажатию', async () => {
    const user = userEvent.setup();
    renderApp();

    const [first, second] = metaExample.presets;
    const secondButton = await screen.findByRole('button', { name: second.name });
    expect(screen.getByRole('button', { name: first.name })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(secondButton);

    expect(secondButton).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(second.description)).toBeInTheDocument();
  });

  it('показывает код и текст ошибки API', async () => {
    server.use(
      http.get('*/api/v1/meta', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'Сервис временно недоступен.' } },
          { status: 500 },
        ),
      ),
    );
    renderApp();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('INTERNAL');
    expect(alert).toHaveTextContent('Сервис временно недоступен.');
  });
});
