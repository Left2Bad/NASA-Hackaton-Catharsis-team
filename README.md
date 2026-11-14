# Календарь пожарной активности MODIS + VIIRS

Проект команды Catharsis для NASA Space Apps Challenge 2026, трек
«Harmonization of MODIS and VIIRS Hot Spots».

Веб-приложение сводит две несовместимые спутниковые записи о пожарах (MODIS с 2000 года и VIIRS с 2012 года)
в один согласованный ряд и показывает его как календарь пожарной активности для любой выбранной области.

> Состояние: создан каркас репозитория и контракт API. Код пайплайна, бэкенда и фронтенда ещё не написан.

## Структура

```text
├── contract/    общая зона: openapi.yaml и примеры ответов
├── pipeline/    зона A: загрузка FIRMS, единая схема, гармонизация, проверка
├── backend/     зона A: API на FastAPI
├── frontend/    зона B: React-приложение
├── docs/
│   ├── methodology.md   зона A: метод и результаты проверки
│   └── demo/            зона B: сценарий демо, скриншоты, слайды
├── data/        данные, в git не попадают
└── .github/     CI по папкам и CODEOWNERS
```

## Кто чем владеет

| Путь | Владелец | Кто может менять |
| --- | --- | --- |
| `pipeline/`, `backend/`, `docs/methodology.md`, `workflows/backend.yml` | A | только A |
| `frontend/`, `docs/demo/`, `workflows/frontend.yml` | B | только B |
| `contract/` | оба | отдельный PR, одобрение второго обязательно |
| `README.md`, корневые конфиги | оба | отдельный короткий PR, предупредив в чате |

## Правила работы с Git

1. Ветка `main` всегда рабочая, прямых пушей в неё нет. Рабочие ветки: `a/<задача>` и `b/<задача>`,
   например `a/A4-filters`, `b/B6-calendar`.
2. Одна задача — один PR, ветка живёт не дольше 1–2 дней. Слияние через squash.
3. Перед началом работы и перед PR: `git fetch`, затем `git rebase origin/main`.
4. PR содержит файлы только из своей зоны. Нужна правка в чужой — просим владельца.
5. Правки `contract/`, `README.md` и корневых конфигов идут отдельным PR и сливаются в тот же час.
6. Данные, `.env` и ключи в git не попадают.

## Быстрый старт

Проверить контракт и примеры:

```bash
pip install -r contract/tools/requirements.txt
```

```bash
python contract/tools/validate.py
```

Подготовить окружение: скопируйте `.env.example` в `.env` и впишите ключ FIRMS
(бесплатно: https://firms.modaps.eosdis.nasa.gov/api/map_key/).

Команды запуска пайплайна, API и фронтенда появятся здесь по мере готовности (задачи A2, A6, B2).

## Что сделать сразу после клонирования

- [ ] Вписать логины GitHub в `.github/CODEOWNERS` и раскомментировать строки.
- [ ] Включить защиту ветки `main` в настройках репозитория: слияние только через PR.
- [ ] Вдвоём прочитать `contract/openapi.yaml` и подтвердить, что полей хватает для каждого элемента экрана.

## Данные

Источник — NASA FIRMS (Fire Information for Resource Management System):
https://www.earthdata.nasa.gov/data/tools/firms

We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS),
part of NASA's Earth Science Data and Information System (ESDIS).
