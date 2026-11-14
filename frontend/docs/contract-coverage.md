# Из каких полей контракта рисуется экран

Результат задачи B1: каждое требование F1–F27 из ТЗ сверено с `contract/openapi.yaml` (версия 0.1.0)
и примерами из `contract/examples/`.

**Вывод: для всех требований с приоритетом «Обязательно» полей хватает, блокирующих пробелов нет.**
Найдено семь мелких вопросов к контракту, они собраны в [последнем разделе](#вопросы-и-предложения-к-контракту).
Ни один из них не мешает начинать B2–B9 на моках.

Как читать таблицы: `meta`, `calendar`, `current`, `points`, `daily`, `validation` — ответы эндпоинтов
`GET /meta`, `POST /calendar`, `POST /current`, `POST /points`, `POST /daily`, `GET /method/validation`.
«Запрос» — поля тела `AreaQuery`. «Клиент» — фронтенд считает сам, от API ничего не нужно.

## Выбор области и периода

| ID | Требование | Откуда берём | Замечания |
| --- | --- | --- | --- |
| F1 | Рисование прямоугольника и полигона | Запрос: `geometry` (`Polygon` или `MultiPolygon`) | Прямоугольник отправляем как `Polygon` из 5 точек. Кольцо замыкаем сами, порядок — долгота, широта |
| F2 | Ввод границ или точки с радиусом | Запрос: `geometry` | Круга в контракте нет: клиент строит по точке и радиусу многоугольник (64 вершины) |
| F3 | Области-примеры | `meta.presets[]`: `id`, `name`, `description`, `geometry` | `id` стабилен — он же пойдёт в адрес страницы (F26) |
| F4 | Период по годам | Запрос: `start_year`, `end_year`. Границы выбора: `meta.first_date`, `meta.last_date` | Без этих полей сервер берёт весь ряд. Базовый период: запрос `baseline`, фактический — `calendar.baseline` |
| F5 | Лимит площади и предупреждение о маленькой области | `meta.limits.max_area_km2` — проверка до запроса. Ошибка 413 `AREA_TOO_LARGE`. Предупреждение `AREA_SMALL` в `calendar.warnings[]`. В ответе: `calendar.area_km2`, `calendar.cells` | Площадь до запроса клиент считает сам (геодезическая). Покрытие: `meta.coverage`, ошибка 404 `NO_DATA`, предупреждение `PARTIAL_COVERAGE` |
| F6 | Загрузка GeoJSON | Запрос: `geometry` | Клиент достаёт геометрию из `Feature` и `FeatureCollection`, остальные типы отклоняет сам |

## Календарь

| ID | Требование | Откуда берём | Замечания |
| --- | --- | --- | --- |
| F7 | Сетка «год × месяц» | `calendar.months[]`: `year`, `month`, `value` | Месяцев вне ряда в ответе нет (январь–октябрь 2000, будущие): такие клетки рисуем пустыми |
| F8 | Итог за год, медиана по месяцам | `calendar.yearly[]`: `year`, `total`, `complete`. `calendar.monthly_baseline[]`: `month`, `median` | Неполные годы (`complete` = false) помечаем |
| F9 | Подсказка по ячейке | `calendar.months[]`: `value`, `median`, `anomaly_pct`, `low`, `high`, `source`, `preliminary`, `partial`, `percentile`, `category`. Название источника: `meta.sources[].label` по `id` | Если `anomaly_pct` = `null` (медиана 0), показываем разность `value − median` в точках |
| F10 | Режим «количество / аномалия» | `calendar.months[].value` и `calendar.months[].anomaly_pct` | Переключение без нового запроса. Клетки с `anomaly_pct` = `null` — нейтральный цвет |
| F11 | Доступные шкалы и легенда с числами | Клиент | Границы легенды считаем по `value` и `anomaly_pct` |
| F12 | Шкала по квантилям или логарифмическая | Клиент, по `calendar.months[].value` | Квантили считаем по всем месяцам ответа |
| F13 | Точки месяца на карте | `points.features[]`: `geometry.coordinates`, `properties.*`. `points.total`, `points.truncated` | Запрос `PointsQuery`: `geometry`, `year`, `month`. Лимит: `meta.limits.max_points` |
| F14 | Дневной календарь года | `daily.days[]`: `date`, `value`, `preliminary` | Запрос `DailyQuery`: `geometry`, `year`, `metric` |

## Аналитика

| ID | Требование | Откуда берём | Замечания |
| --- | --- | --- | --- |
| F15 | Панель «Сейчас» | `current`: `as_of`, `year`, `month`, `days_elapsed`, `value`, `baseline_same_days.median`, `anomaly_pct`, `percentile`, `category`, `source`, `preliminary`. График: `current.cumulative[]`: `day`, `value`, `median` | Статус «норма / выше / экстремально» — из `category` (5 значений). См. вопрос 7 |
| F16 | Сводка из 4 чисел | `calendar.summary`: `peak_year`, `peak_month`, `total`, `trend_pct_per_decade` | Направление тренда — знак числа. `null` — «недостаточно данных». См. вопрос 2 |
| F17 | Сезонный профиль | `calendar.monthly_baseline[]`: `median`, `p10`, `p90`. Линия года: `calendar.months[]` с нужным `year` | Запрос не повторяем: год выбирается из уже полученного ответа |
| F18 | Годовые суммы с трендом | `calendar.yearly[]`: `year`, `total`, `complete` | Линию тренда пока считаем сами по полным годам. См. вопрос 2 |
| F19 | «Единый ряд / исходные сенсоры» | Запрос: `series` = `raw`. Ответ: `calendar.months[].raw`: `modis`, `viirs_snpp`, `viirs_n20` | `value` остаётся значением единого ряда, поэтому оба ряда рисуются из одного ответа |
| F20 | Сравнение двух областей или лет | Два запроса `/calendar`; для двух лет — один ответ | — |
| F21 | Режим FRP | Запрос: `metric` = `frp`. Подпись: `calendar.unit`, `calendar.metric` | См. вопрос 5 |

## Выгрузка и прочее

| ID | Требование | Откуда берём | Замечания |
| --- | --- | --- | --- |
| F22 | CSV горячих точек | `POST /export/points.csv`, запрос `ExportPointsQuery`: `geometry`, `start_date`, `end_date`. Ошибка 413 `EXPORT_TOO_LARGE`, лимит `meta.limits.max_export_rows` | Годы периода переводим в даты: 1 января `start_year` – 31 декабря `end_year`, но не позже `meta.last_date`. См. вопросы 4 и 6 |
| F23 | CSV месячной таблицы | `POST /export/calendar.csv`, запрос `AreaQuery` | Колонки совпадают с `calendar.months[]`, поэтому в запасном режиме (B13) файл можно собрать на клиенте |
| F24 | PNG с подписью | Клиент. Подпись: название примера или границы области, `calendar.area_km2`, годы периода, `calendar.data_through`, `meta.data_version` | Текст об источнике (NASA FIRMS) — статический |
| F25 | Страница «Метод» | `validation`: `calibration_period`, `test_period`, `regions[]` (`name`, `metrics.pearson_r`, `metrics.bias_pct`, `metrics.mape_pct`, `metrics.n_months`, `series[]`), `seams[]` (`label`, `ratio_harmonized`, `ratio_naive`), `limitations[]`. Состав ряда: `meta.sources[]` | Ряды проверки покрывают только 2021–2025. График «до и после» за весь период строим запросом `/calendar` с `series` = `raw` для области-примера |
| F26 | Состояние в адресе страницы | Клиент | В адрес пишем `id` примера или координаты, годы, режим |
| F27 | Два языка | Клиент; тексты сервера — см. вопрос 3 | Свои подписи переводим сами |

## Элементы экрана вне списка F

| Элемент | Откуда берём |
| --- | --- |
| Пустой результат («пожаров не зафиксировано», раздел 5.5 ТЗ) | Ответ 200: `calendar.summary.total` = 0, `calendar.summary.peak_year` = `null` |
| Ошибка | `error.code`, `error.message`. Коды: `INVALID_GEOMETRY`, `INVALID_REQUEST`, `AREA_TOO_LARGE`, `EXPORT_TOO_LARGE`, `NO_DATA`, `INTERNAL` |
| Пометка «предварительно» | `calendar.months[].preliminary`, `current.preliminary`, `daily.days[].preliminary`, граница — `meta.last_standard_date`, предупреждение `PRELIMINARY_DATA` |
| Неполный месяц | `calendar.months[].partial`; у него `percentile` и `category` равны `null` |
| Предупреждения над календарём | `calendar.warnings[]`, `current.warnings[]`: `code`, `message` |
| Перерывы в работе спутников (раздел 4.5 ТЗ) | Только общее предупреждение `SENSOR_GAP`. См. вопрос 1 |
| Версия и дата данных в подвале | `meta.data_version`, `calendar.data_through` |
| Какой сенсор ведёт ряд (полоса над календарём) | `meta.sources[]`: `id`, `label`, `start`, `end` |

## Вопросы и предложения к контракту

Все предложения — необязательные поля или уточнения описаний. По правилам `contract/README.md`
такие правки можно вносить в любой момент отдельным PR. Здесь они только перечислены.

| № | Что не так | Кого касается | Предложение |
| --- | --- | --- | --- |
| 1 | Раздел 4.5 ТЗ требует помечать месяцы с перерывами в работе спутников, но в `MonthValue` такого признака нет. Есть только общее предупреждение `SENSOR_GAP` с текстом | F9, раздел 4.5 | Необязательное поле `sensor_gap: boolean` в `MonthValue` |
| 2 | `trend_pct_per_decade` даёт наклон в процентах, но не сказано, от чего считается процент и каким методом. Линию тренда (F18) по нему не построить, а посчитанная на клиенте может разойтись с числом в сводке | F16, F18 | Описать метод в `CalendarSummary` или добавить необязательный объект `trend` с наклоном и сдвигом в единицах ряда |
| 3 | Тексты сервера приходят на одном языке: `presets[].name`, `sources[].label`, `warnings[].message`, `error.message`, `seams[].label`, `regions[].name`, `limitations[]` | F27 | Договориться: клиент переводит по `id` и `code`, текст сервера — запасной вариант. У `limitations[]` кодов нет: либо добавить `id`, либо параметр языка в запросе |
| 4 | Раздел 11.2 ТЗ: CSV должен содержать указание источника. В примерах есть только строка заголовков | F22, F23 | Решить, где указываем NASA FIRMS: в имени файла, в отдельной колонке или в тексте рядом с кнопкой. Строка-комментарий в начале файла сломает открытие в Excel |
| 5 | `unit` — свободная строка. Для `metric` = `count` в примерах `viirs_snpp_equivalent_detections`, значение для `frp` нигде не названо | F21 | Перечислить допустимые значения `unit` в описании схемы |
| 6 | Заголовок `Content-Disposition` описан только у `points.csv`. Без `Access-Control-Expose-Headers` клиент его всё равно не прочитает | F22, F23 | Имя файла задаёт клиент. От бэкенда ничего не нужно, заголовок можно не описывать |
| 7 | `/current` принимает `AreaQuery`, но поля `start_year`, `end_year` и `series` для него не имеют смысла | F15 | Дописать в описании, что учитываются только `geometry`, `baseline` и `metric` |

Приоритет: вопросы 1–3 влияют на код фронтенда и их стоит закрыть до этапа 2; вопросы 4–7 можно решить в рабочем порядке.

Вопросы 1–3 решаются отдельным PR в `contract/`: признак перерыва у месяца, линия тренда и коды
для перевода текстов. Когда он будет слит, новые поля появятся в таблицах выше.
