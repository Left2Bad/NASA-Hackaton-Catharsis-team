import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw/http';
import { afterEach, describe, expect, it } from 'vitest';
import calendarExample from '../../contract/examples/calendar.response.json';
import metaExample from '../../contract/examples/meta.json';
import App from './App';
import { server } from './mocks/server';
import { VISIONS } from './theme/cvd';

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  window.location.hash = '';
});

describe('главный экран на моках', () => {
  it('показывает раскладку: выбор области слева, панель справа', async () => {
    renderApp();

    const presets = await screen.findByRole('group', { name: 'Example areas' });
    expect(within(presets).getAllByRole('button')).toHaveLength(metaExample.presets.length);
    expect(screen.getByRole('region', { name: 'Area selection' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fire activity' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Selected area: 61°E to 71°E/ })).toBeInTheDocument();
  });

  it('рисует клетку календаря на каждый месяц ряда', async () => {
    const { container } = renderApp();

    await screen.findByRole('img', { name: /^Fire detections by month/ });
    expect(container.querySelectorAll('[data-month]')).toHaveLength(calendarExample.months.length);
  });

  it('отмечает шов там, где ряд переходит от MODIS к VIIRS', async () => {
    const { container } = renderApp();

    await screen.findByRole('img', { name: /^Fire detections by month/ });
    const seam = (month: string) =>
      container.querySelector(`[data-month="${month}"]`)?.getAttribute('data-seam') ?? '';

    // Январь 2012 ещё ведёт MODIS, с февраля — Suomi NPP.
    expect(seam('2012-01')).not.toContain('left');
    expect(seam('2012-02')).toContain('left');
    expect(seam('2012-03')).not.toContain('left');
    // Февраль 2012 и февраль 2011 вели разные сенсоры.
    expect(seam('2012-02')).toContain('bottom');
  });

  it('показывает сводку из ответа /calendar', async () => {
    renderApp();

    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(
      within(summary).getByText(String(calendarExample.summary.peak_year)),
    ).toBeInTheDocument();
  });

  it('переключает область по нажатию', async () => {
    const user = userEvent.setup();
    renderApp();

    const second = await screen.findByRole('button', { name: 'Southern Amazon' });
    expect(screen.getByRole('button', { name: 'Northern Kazakhstan' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(second);

    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 1, name: 'Southern Amazon' })).toBeInTheDocument();
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

describe('страница цветовых шкал', () => {
  it('показывает обе шкалы для каждого типа зрения', async () => {
    window.location.hash = '#/scales';
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Color scales' })).toBeInTheDocument();
    for (const vision of VISIONS) {
      expect(screen.getAllByRole('heading', { level: 3, name: vision.label })).toHaveLength(2);
    }
    // Образцы календаря появляются после загрузки данных: по одному на шкалу и тип зрения.
    const samples = await screen.findAllByRole('img', { name: /, 2008 to 2013, / });
    expect(samples).toHaveLength(VISIONS.length * 2);
  });
});
