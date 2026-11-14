# backend/ — зона разработчика A

API на FastAPI. Читает готовые файлы из `data/` (DuckDB, только чтение) и отдаёт ответы
строго по контракту `contract/openapi.yaml`.

Задачи из ТЗ: A6 (каркас, `/health`, `/meta`, `/calendar`), A11 (остальные эндпоинты, лимиты, ошибки), A13 (деплой).

## Запуск

Нужны данные в `data/` (как их получить — `data/README.md`): `grid_daily.parquet`, `grid_monthly.parquet`,
`coefficients.parquet`, `uncertainty.parquet`, `outage_months.csv`, `harmonized/summary.json`;
для `/points` и `/export/points.csv` — `points_serve/` (`python pipeline/points_serve.py`).

```bash
python -m venv .venv
.venv/Scripts/pip install -e "backend[dev]"     # Linux/macOS: .venv/bin/pip
cd backend
uvicorn app.main:app --port 8000
```

Документация API: http://localhost:8000/api/v1/docs. Фронтенду: `VITE_API_URL=http://localhost:8000/api/v1`.

Переменные окружения (`.env.example`): `DATA_DIR` (по умолчанию `data/` в корне), `POINTS_DIR`
(по умолчанию `DATA_DIR/points_serve`; годится и полная `data/points`), `CORS_ORIGINS`,
`DUCKDB_MEMORY_LIMIT` (2GB), `DUCKDB_THREADS` (2).

## Что готово

| Эндпоинт | Статус |
| --- | --- |
| `GET /health`, `GET /meta` | готово |
| `POST /calendar`, `POST /export/calendar.csv` | готово |
| `POST /current`, `POST /daily` | готово |
| `POST /points`, `POST /export/points.csv` | готово |
| `GET /method/validation` | готово |

## Как устроено

- `app/geometry.py` — проверка GeoJSON, геодезическая площадь (WGS84), ячейки 0,1° с центром внутри области.
- `app/series.py` — сумма по ячейкам области: сырой счёт ведущего источника × коэффициент ячейки 1°
  (`data/coefficients.parquet`). Правило ведущего источника — общий модуль `pipeline/lead.py`.
- `app/daily_service.py` — `/current`: накопление с 1-го числа против тех же дней базовых лет; `/daily`: значения по дням года.
- `app/calendar_service.py` — медианы и перцентили по базовым годам, категории, интервалы `low`/`high`
  (`data/uncertainty.parquet`), годовые суммы, тренд (МНК), предупреждения.
- `app/points_service.py` — точки из `points_serve/`: отбор по дате и прямоугольнику в DuckDB (пропуск групп строк),
  затем точная проверка полигона; `harmonized_weight` — коэффициент ячейки 1° ведущего источника (S-NPP — 1).
  Больше `max_points` — 20 000 точек с наибольшим FRP и `truncated = true`; CSV отдаётся потоком.
- Ответы `/calendar` кешируются в памяти (200 последних запросов).
- Ошибки — всегда `{"error": {"code", "message"}}`; ошибки проверки тела запроса отдаются как 400 `INVALID_REQUEST`.

## Проверки (как в CI)

```bash
cd backend
ruff check . && ruff format --check . && pytest -q
```

Тесты строят крошечный синтетический `DATA_DIR` и проверяют каждый ответ схемой из `contract/openapi.yaml`.
