# contract/ — shared zone

The API contract between the backend (developer A) and the frontend (developer B).
This is the only place where the work of the two developers overlaps.

| File | What it is |
| --- | --- |
| `openapi.yaml` | API schema: endpoints, request and response bodies, error codes |
| `examples/` | Example requests and responses for every endpoint |
| `tools/validate.py` | Check: the schema is valid and the examples match it |
| `tools/generate_examples.py` | Example generator (synthetic data, fixed seed) |

## How to use it

**Developer A** implements the endpoints so that real responses pass validation against the same schemas
as the examples.

**Developer B** generates TypeScript types from `openapi.yaml` and builds mocks from the files in `examples/`.

Check before a PR:

```bash
pip install -r contract/tools/requirements.txt
```

```bash
python contract/tools/validate.py
```

## Rules for changes

1. The contract changes in a **separate small PR**, with no backend or frontend code in the same PR.
2. The PR is approved by the other developer. Merge it within the hour so nobody works on a stale version.
3. **Adding** an optional field or a new endpoint is allowed at any time.
4. **Renaming or removing a field, or changing its type** — only after a call. The examples are updated in the same PR.
5. Examples are edited through the generator: change `generate_examples.py` → run it → run `validate.py`.
   A new example file must be added to the list in `validate.py`, otherwise the check fails.

## Conventions

- Field names in `snake_case`.
- Dates in ISO 8601 (`YYYY-MM-DD`), times in UTC.
- Coordinates in GeoJSON order: longitude first, then latitude.
- Months are numbered 1–12.
- A missing value is `null`, not an omitted field.
- Errors always have the form `{"error": {"code": "...", "message": "..."}}`.
- An area without fires is not an error: the response is 200 with values of 0.
- Human-readable texts (`message`, `label`, `name`, `description`, `limitations`) are served in a single language.
  Identifiers (`id`, `code`, enum values) are stable: a client can show its own translation based on them,
  using the server text as a fallback.
