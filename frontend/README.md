# frontend/ — зона разработчика B

Веб-приложение: React, TypeScript, Vite, MapLibre GL JS, графики на ECharts или D3.

Задачи из ТЗ: B2–B16.

Как работать до готовности бэкенда:

- Типы TypeScript генерируются из `contract/openapi.yaml` (например, пакетом `openapi-typescript`).
- Моки строятся на файлах из `contract/examples/` (например, через Mock Service Worker).
  Эти же файлы потом становятся запасным режимом демо.
- Адрес настоящего API задаётся переменной `VITE_API_URL` (см. `.env.example` в корне).

Здесь свой `package.json`. CI: `.github/workflows/frontend.yml`.
Файлы в `pipeline/`, `backend/` и `contract/` из этой зоны не правятся
(контракт меняется отдельным PR, см. `contract/README.md`).
