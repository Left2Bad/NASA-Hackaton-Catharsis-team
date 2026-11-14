"""Validates the contract: openapi.yaml itself and that the examples match its schemas.

Run from the repository root:
    pip install -r contract/tools/requirements.txt
    python contract/tools/validate.py

Exit code 0 means everything is fine; 1 means there are mismatches (they are printed).
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

# Which schema from components.schemas each example must match.
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
    """Rules a schema cannot express: month order and completeness of the baseline table."""
    problems = []
    keys = [(m["year"], m["month"]) for m in payload["months"]]
    if keys != sorted(keys):
        problems.append(f"{name}: months are not sorted by date")
    if len(set(keys)) != len(keys):
        problems.append(f"{name}: months contains duplicate months")
    for (year, month), (next_year, next_month) in zip(keys, keys[1:]):
        if (next_year, next_month) != (year + month // 12, month % 12 + 1):
            problems.append(f"{name}: gap in months after {year}-{month:02d}")
            break
    if [b["month"] for b in payload["monthly_baseline"]] != list(range(1, 13)):
        problems.append(f"{name}: monthly_baseline must contain months 1–12 in order")
    for m in payload["months"]:
        if not m["low"] <= m["value"] <= m["high"]:
            problems.append(f"{name}: {m['year']}-{m['month']:02d} violates low <= value <= high")
            break
    if payload["series"] == "raw" and any("raw" not in m for m in payload["months"]):
        problems.append(f"{name}: with series=raw every month must have a raw field")
    return problems


def main() -> int:
    spec = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
    problems: list[str] = []

    try:
        validate_spec(spec)
    except Exception as error:  # noqa: BLE001 - show any failure reason
        problems.append(f"openapi.yaml: {error}")

    schemas = spec["components"]["schemas"]
    on_disk = {p.name for p in EXAMPLES.iterdir() if p.is_file() and p.name != "README.md"}
    known = set(JSON_EXAMPLES) | set(CSV_EXAMPLES)
    for name in sorted(on_disk - known):
        problems.append(f"{name}: file is not described in validate.py - add it to JSON_EXAMPLES or CSV_EXAMPLES")
    for name in sorted(known - on_disk):
        problems.append(f"{name}: example is missing from contract/examples/")

    for name, schema_name in JSON_EXAMPLES.items():
        path = EXAMPLES / name
        if not path.exists():
            continue
        if schema_name not in schemas:
            problems.append(f"{name}: the contract has no schema {schema_name}")
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        schema = {"$ref": f"#/components/schemas/{schema_name}", "components": spec["components"]}
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        for error in sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))[:5]:
            where = "/".join(str(part) for part in error.absolute_path) or "(root)"
            problems.append(f"{name} [{schema_name}] {where}: {error.message[:200]}")
        if schema_name == "CalendarResponse":
            problems.extend(check_calendar(name, payload))

    for name, header in CSV_EXAMPLES.items():
        path = EXAMPLES / name
        if not path.exists():
            continue
        with path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.reader(handle))
        if not rows or rows[0] != header:
            problems.append(f"{name}: header does not match the contract")
        elif any(len(row) != len(header) for row in rows[1:]):
            problems.append(f"{name}: rows have different numbers of columns")

    if problems:
        print(f"Mismatches found: {len(problems)}")
        for line in problems:
            print(f"  - {line}")
        return 1

    print(f"Contract is fine: openapi.yaml is valid, examples checked: {len(known)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
