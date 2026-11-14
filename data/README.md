# data/

Папка для данных. В git попадает только этот файл: всё остальное в `data/` исключено в `.gitignore`.

Ожидаемая раскладка (её создаёт пайплайн):

```text
data/
├── raw/                      # скачанные CSV и архивы FIRMS
├── points/                   # точки в единой схеме, Parquet, по сенсору и году
├── grid_daily.parquet        # ячейка 0,1° × день × спутник
├── coefficients.parquet      # коэффициенты гармонизации
├── harmonized_daily.parquet  # единый ряд
├── static_mask.parquet       # постоянные источники (факелы, заводы, вулканы)
└── validation/report.json    # метрики проверки качества
```

Источник данных: NASA FIRMS (https://www.earthdata.nasa.gov/data/tools/firms).
