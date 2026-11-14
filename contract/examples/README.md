# contract/examples/

Примеры запросов и ответов API. **Числа синтетические** — они сгенерированы скриптом
`contract/tools/generate_examples.py` и нужны для макетов и моков. Это не результаты обработки FIRMS.
Признак синтетики в самих ответах: `data_version` = `synthetic-example-0.1`.

Область в примерах — прямоугольник в степной зоне (61–71° в. д., 51–55° с. ш.) с двумя волнами
горения, весной и в конце лета. Период — с ноября 2000 по 13 ноября 2026.

| Файл | Эндпоинт | Схема |
| --- | --- | --- |
| `health.json` | `GET /health` | `Health` |
| `meta.json` | `GET /meta` | `Meta` |
| `calendar.request.json` | `POST /calendar`, тело запроса | `AreaQuery` |
| `calendar.response.json` | `POST /calendar`, единый ряд | `CalendarResponse` |
| `calendar_raw.response.json` | `POST /calendar` при `series` = `raw` | `CalendarResponse` |
| `current.response.json` | `POST /current` | `CurrentResponse` |
| `points.request.json` | `POST /points`, тело запроса | `PointsQuery` |
| `points.response.json` | `POST /points` | `PointsResponse` |
| `daily.request.json` | `POST /daily`, тело запроса | `DailyQuery` |
| `daily.response.json` | `POST /daily` | `DailyResponse` |
| `export_points.request.json` | `POST /export/points.csv`, тело запроса | `ExportPointsQuery` |
| `export_points.csv` | `POST /export/points.csv` | колонки в `openapi.yaml` |
| `export_calendar.csv` | `POST /export/calendar.csv` | колонки в `openapi.yaml` |
| `method_validation.response.json` | `GET /method/validation` | `ValidationResponse` |
| `error_*.json` | ответы с ошибкой | `ErrorResponse` |

Что стоит проверить в интерфейсе на этих примерах:

- **Экстремальный год** — 2010, август почти в четыре раза выше медианы.
- **Неполный месяц** — ноябрь 2026: `partial` = true, `percentile` и `category` равны `null`.
- **Предварительные данные** — месяцы с июля 2026: `preliminary` = true.
- **Смена источника** — `source` меняется в августе 2002, феврале 2012 и ноябре 2026.
- **Интервал** — в эпоху MODIS `low` и `high` отличаются от `value`, в эпоху Suomi NPP совпадают с ним.
