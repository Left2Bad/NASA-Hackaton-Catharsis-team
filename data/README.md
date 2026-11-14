# data/

Папка для данных. В git попадает только этот файл: всё остальное в `data/` исключено в `.gitignore`.
Источник данных: NASA FIRMS (https://www.earthdata.nasa.gov/data/tools/firms).

## Раскладка

```text
data/
├── raw/                                  # архивы FIRMS (шаг 0) — 48 zip, 9,3 ГБ
│   ├── modis_<год>_all_countries.zip         2000–2025
│   ├── viirs-snpp_<год>_all_countries.zip    2012–2025
│   ├── viirs-jpss1_<год>_all_countries.zip   2018–2025 (NOAA-20)
│   └── api_2026/<сенсор>/*.csv               2026 через Area API (шаг 4)
├── points/<сенсор>_<год>.parquet         # все точки в единой схеме (шаг 1) — 7,1 ГБ
├── grid_daily.parquet                    # ячейка 0,1° × день: счёты и FRP по спутникам (шаг 2) — 680 МБ
├── grid_monthly.parquet                  # то же по месяцам (шаг 2) — 230 МБ
├── coefficients.parquet                  # коэффициенты по ячейкам 1° (шаг 3)
├── uncertainty.parquet                   # интервалы low/high по величине значения (шаг 3)
├── outage_months.csv                     # месяцы сбоев S-NPP, где ведёт NOAA-20 (шаг 3)
└── harmonized/
    ├── summary.json                          мировые коэффициенты, периоды, метрики проверки
    └── global_monthly.csv                    единый ряд по миру, для проверки и презентации
```

---

## Инструкция для ИИ-ассистента (Claude Code и т. п.): как подготовить данные

Цель — получить в `data/` ровно ту раскладку, что выше. Работай из корня репозитория.
Ничего из `data/` не коммить. Ключи и `.env` не коммить.

### Вариант А — есть готовый архив команды (быстро, ~5 минут)

Команда передаёт архив данных (`FIRMS_data_*.zip`, ~1 ГБ) через Google Диск. Пользователь сам скачивает его
и называет путь к файлу. Внутри архива пути относительно корня репозитория и все начинаются с `data/`.

1. Проверь архив: `python -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip())" <путь>` → `None`.
2. Распакуй в корень репозитория только пути, начинающиеся с `data/`:

   ```bash
   python -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); [z.extract(n,'.') for n in z.namelist() if n.startswith('data/')]" <путь>
   ```

3. Проверь, что появились `data/grid_daily.parquet`, `data/grid_monthly.parquet`, `data/coefficients.parquet`,
   `data/uncertainty.parquet`, `data/outage_months.csv`, `data/harmonized/summary.json`, и что в `summary.json`
   `global_coefficients.count_ta` ≈ 4.07.

Этого достаточно для бэкенда (календарь, «Сейчас», дневной ряд, страница «Метод»).
Точек (`data/points/`) в архиве нет — они нужны только для `/points` и выгрузки CSV точек; см. вариант Б.

### Вариант Б — собрать всё самому (~1,5 часа, ~20 ГБ места на диске, ≥12 ГБ RAM)

1. Окружение: `python -m venv .venv`, затем `.venv/Scripts/pip install -e "pipeline[dev]"` (Linux/macOS: `.venv/bin/pip`).
2. Проверь свободное место: нужно ≥ 20 ГБ.
3. `python pipeline/download_archives.py` — 48 архивов в `data/raw/`. Логин не нужен.
   Если сервер отвечает не 200 (техобслуживание FIRMS), сообщи пользователю и не ищи других источников.
4. `python pipeline/to_parquet.py data/raw/*.zip` — одним процессом, не параллельно (память).
5. `python pipeline/grid.py`, затем `python pipeline/harmonize.py`.
6. Проверка: 48 файлов в `data/points/`; в выводе `harmonize.py` строки
   `S-NPP outage months: ['2022-07', '2022-08', '2024-07', '2024-11']` и `contract count_ta {'pearson_r': 0.99...`.

### 2026 год (необязательно)

Нужен бесплатный ключ FIRMS: пользователь получает его сам на https://firms.modaps.eosdis.nasa.gov/api/map_key/
и вписывает в `.env` (`FIRMS_MAP_KEY=...`, образец — `.env.example`). Затем:
`python pipeline/fetch_api.py` → `python pipeline/api_to_parquet.py` → `python pipeline/grid.py --years 2026` → `python pipeline/harmonize.py`.
Загрузка идёт 1,5–2,5 часа из-за лимита ключа (5000 транзакций за 10 минут); скрипт сам ждёт квоту.
Не обходи лимит несколькими ключами.
