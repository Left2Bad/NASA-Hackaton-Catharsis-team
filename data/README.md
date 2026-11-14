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
│   └── api_2026/<сенсор>/*.csv               2026 через Area API (шаг 3)
├── points/<сенсор>_<год>.parquet         # все точки в единой схеме (шаг 1) — 7,1 ГБ
└── harmonized/                           # результат гармонизации (шаг 2) — 220 МБ
    ├── grid_monthly_025deg.parquet           ячейка 0,25° × месяц: сырые счёты по сенсорам + hotspots, frp_total
    ├── country_monthly.csv                   календарь по странам
    ├── global_monthly.csv                    календарь по миру
    ├── harmonization_factors_1deg.csv        веса точек по ячейкам 1°
    ├── ratios_1deg.parquet                   детали подгонки коэффициентов
    ├── snpp_outage_months.csv                месяцы сбоев S-NPP, заменённые NOAA-20
    ├── summary.json                          глобальные коэффициенты и метрики проверки
    └── METHOD.md                             краткое описание метода
```

---

## Инструкция для ИИ-ассистента (Claude Code и т. п.): как подготовить данные

Цель — получить в `data/` ровно ту раскладку, что выше. Работай из корня репозитория.
Ничего из `data/` не коммить. Ключи и `.env` не коммить.

### Вариант А — есть готовый архив команды (быстро, ~5 минут)

Команда передаёт `FIRMS_harmonized_2000-2025.zip` (≈220 МБ) через Google Диск. Пользователь сам скачивает его
и называет путь к файлу. Внутри архива пути относительно корня проекта:

```text
data/harmonized/...        → нужно
scripts/*.py               → НЕ нужно (это старые копии pipeline/, игнорировать)
data/TASK_for_friend_claude.md → НЕ нужно
```

1. Проверь архив: `python -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip())" <путь>` → `None`.
2. Распакуй **только** `data/harmonized/*` в корень репозитория, чтобы файлы оказались в `data/harmonized/`:

   ```bash
   python -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); [z.extract(n,'.') for n in z.namelist() if n.startswith('data/harmonized/')]" <путь>
   ```

3. Проверь: в `data/harmonized/` 8 файлов, `grid_monthly_025deg.parquet` ≈ 219 МБ,
   `summary.json` содержит `global_ratio_viirs_per_modis_TA` ≈ 4.10.

Этого достаточно для бэкенда и фронтенда (календарь, аномалии, графики).
Сырых точек (`data/points/`) в архиве нет — они нужны только для выгрузки CSV точек по области; см. вариант Б.

### Вариант Б — собрать всё самому (~1,5 часа, ~20 ГБ места на диске, ≥12 ГБ RAM)

1. Окружение: `python -m venv .venv`, затем `.venv/Scripts/pip install -e pipeline` (Linux/macOS: `.venv/bin/pip`).
2. Проверь свободное место: нужно ≥ 20 ГБ.
3. `python pipeline/00_download_archives.py` — 48 архивов в `data/raw/`. Логин не нужен.
   Если сервер отвечает не 200 (техобслуживание FIRMS), сообщи пользователю и не ищи других источников.
4. `python pipeline/01_to_parquet.py data/raw/*.zip` — одним процессом, не параллельно (память).
5. `python pipeline/02_harmonize.py`.
6. Проверка: 48 файлов в `data/points/`, в выводе шага 5 строка
   `validation 2019-2025 ... 'r_country_month': 0.98...` и `S-NPP outage months: [('2022-07', ...), ('2022-08', ...), ('2024-07', ...), ('2024-11', ...)]`.

### 2026 год (необязательно)

Нужен бесплатный ключ FIRMS: пользователь получает его сам на https://firms.modaps.eosdis.nasa.gov/api/map_key/
и вписывает в `.env` (`FIRMS_MAP_KEY=...`, образец — `.env.example`). Затем:
`python pipeline/03_fetch_2026_api.py` → `python pipeline/04_api_to_parquet.py` → `python pipeline/02_harmonize.py`.
Загрузка идёт 1,5–2,5 часа из-за лимита ключа (5000 транзакций за 10 минут); скрипт сам ждёт квоту.
Не обходи лимит несколькими ключами.
