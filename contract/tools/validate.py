"""Проверяет контракт: сам openapi.yaml и соответствие примеров его схемам.

Запуск из корня репозитория:
    pip install -r contract/tools/requirements.txt
    python contract/tools/validate.py

Код возврата 0 — всё в порядке, 1 — есть расхождения (их список печатается).
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate as validate_spec

CONTRACT = Path(__file__).resolve().parents[1]
SPEC_PATH = CONTRACT / "openapi.yaml"
EXAMPLES = CONTRACT / "examples"

# Какой схеме из components.schemas должен соответствовать каждый пример.
JSON_EXAMPLES = {
    "health.json": "Health",
    "meta.json": "Meta",
    "calendar.request.json": "AreaQuery",
    "calendar.response.json": "CalendarResponse",
    "calendar_raw.response.json": "CalendarResponse",
    "current.response.json": "CurrentResponse",
    "points.request.json": "PointsQuery",
    "points.response.json": "PointsResponse",
    "daily.request.json": "DailyQuery",
    "daily.response.json": "DailyResponse",
    "export_points.request.json": "ExportPointsQuery",
    "method_validation.response.json": "ValidationResponse",
    "error_area_too_large.json": "ErrorResponse",
    "error_invalid_geometry.json": "ErrorResponse",
    "error_no_data.json": "ErrorResponse",
}

CSV_EXAMPLES = {
    "export_points.csv": [
        "lat", "lon", "acq_datetime", "sensor", "satellite", "conf_class", "frp",
        "daynight", "pixel_km2", "type", "quality", "harmonized_weight",
    ],
    "export_calendar.csv": [
        "year", "month", "value", "low", "high", "median", "anomaly_pct",
        "percentile", "category", "source", "preliminary", "partial",
    ],
}


def check_calendar(name: str, payload: dict) -> list[str]:
    """Правила, которые схемой не выразить: порядок месяцев и полнота базовой таблицы."""
    problems = []
    keys = [(m["year"], m["month"]) for m in payload["months"]]
    if keys != sorted(keys):
        problems.append(f"{name}: months не отсортированы по дате")
    if len(set(keys)) != len(keys):
        problems.append(f"{name}: в months есть повторяющиеся месяцы")
    for (year, month), (next_year, next_month) in zip(keys, keys[1:]):
        if (next_year, next_month) != (year + month // 12, month % 12 + 1):
            problems.append(f"{name}: пропуск в months после {year}-{month:02d}")
            break
    if [b["month"] for b in payload["monthly_baseline"]] != list(range(1, 13)):
        problems.append(f"{name}: monthly_baseline должен содержать месяцы 1–12 по порядку")
    for m in payload["months"]:
        if not m["low"] <= m["value"] <= m["high"]:
            problems.append(f"{name}: {m['year']}-{m['month']:02d} нарушает low <= value <= high")
            break
    for m in payload["months"]:
        if m.get("sensor_gap") and m["source"] != "VIIRS_N20":
            problems.append(f"{name}: {m['year']}-{m['month']:02d} sensor_gap=true, но source не VIIRS_N20")
            break
    if payload["series"] == "raw" and any("raw" not in m for m in payload["months"]):
        problems.append(f"{name}: при series=raw у каждого месяца должно быть поле raw")
    return problems


def main() -> int:
    spec = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
    problems: list[str] = []

    try:
        validate_spec(spec)
    except Exception as error:  # noqa: BLE001 - показываем любую причину отказа
        problems.append(f"openapi.yaml: {error}")

    schemas = spec["components"]["schemas"]
    on_disk = {p.name for p in EXAMPLES.iterdir() if p.is_file() and p.name != "README.md"}
    known = set(JSON_EXAMPLES) | set(CSV_EXAMPLES)
    for name in sorted(on_disk - known):
        problems.append(f"{name}: файл не описан в validate.py — добавьте его в JSON_EXAMPLES или CSV_EXAMPLES")
    for name in sorted(known - on_disk):
        problems.append(f"{name}: пример отсутствует в contract/examples/")

    for name, schema_name in JSON_EXAMPLES.items():
        path = EXAMPLES / name
        if not path.exists():
            continue
        if schema_name not in schemas:
            problems.append(f"{name}: в контракте нет схемы {schema_name}")
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        schema = {"$ref": f"#/components/schemas/{schema_name}", "components": spec["components"]}
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        for error in sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))[:5]:
            where = "/".join(str(part) for part in error.absolute_path) or "(корень)"
            problems.append(f"{name} [{schema_name}] {where}: {error.message[:200]}")
        if schema_name == "CalendarResponse":
            problems.extend(check_calendar(name, payload))
        if schema_name == "ValidationResponse" and "limitation_codes" in payload:
            if len(payload["limitation_codes"]) != len(payload["limitations"]):
                problems.append(f"{name}: limitation_codes и limitations разной длины")

    for name, header in CSV_EXAMPLES.items():
        path = EXAMPLES / name
        if not path.exists():
            continue
        with path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.reader(handle))
        if not rows or rows[0] != header:
            problems.append(f"{name}: заголовок не совпадает с контрактом")
        elif any(len(row) != len(header) for row in rows[1:]):
            problems.append(f"{name}: в строках разное число колонок")

    if problems:
        print(f"Найдено расхождений: {len(problems)}")
        for line in problems:
            print(f"  - {line}")
        return 1

    print(f"Контракт в порядке: openapi.yaml корректен, проверено примеров: {len(known)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
