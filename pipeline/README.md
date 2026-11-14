# pipeline/ — зона разработчика A

Пайплайн данных: от файлов NASA FIRMS до единого гармонизированного ряда.

Шаги (задачи A2–A5, A7–A10, A12 из ТЗ):

1. **Загрузка** — Country Yearly Summary по списку стран и лет (`modis`, `viirs-snpp`, `viirs-jpss1`).
2. **Единая схема** — CSV → `data/points/` в Parquet.
3. **Фильтры** — достоверность, тип источника, маска постоянных источников.
4. **Сетка** — `data/grid_daily.parquet`, ячейка 0,1°.
5. **Калибровка** — коэффициенты MODIS → VIIRS и NOAA-20 → Suomi NPP.
6. **Сборка** — `data/harmonized_daily.parquet`.
7. **Проверка** — `data/validation/report.json`.

Здесь свой `pyproject.toml` и свои зависимости. Файлы в `frontend/` и `contract/` из этой зоны не правятся
(контракт меняется отдельным PR, см. `contract/README.md`).
