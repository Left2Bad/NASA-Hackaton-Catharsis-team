"""GET /health, GET /meta."""

from fastapi import APIRouter, Request

from .. import lead
from ..data import COUNT_UNIT
from ..geometry import STEP
from ..schemas import PRESETS, bbox_polygon

router = APIRouter(tags=["service"])


@router.get("/health")
def health(request: Request) -> dict:
    return {"status": "ok", "data_version": request.app.state.data.data_version}


@router.get("/meta")
def meta(request: Request) -> dict:
    data = request.app.state.data
    s = data.settings
    sources = []
    for sid, start, end in lead.PERIODS:
        if start > data.last_date:
            continue
        sources.append(
            {
                "id": sid,
                "label": lead.LABELS[sid],
                "start": start.isoformat(),
                "end": None if end is None or end >= data.last_date else end.isoformat(),
            }
        )
    return {
        "data_version": data.data_version,
        "unit": COUNT_UNIT,
        "grid_deg": STEP,
        "first_date": data.first_date.isoformat(),
        "last_date": data.last_date.isoformat(),
        "last_standard_date": data.last_standard_date.isoformat(),
        "sources": sources,
        "limits": {
            "max_area_km2": s.max_area_km2,
            "min_cells_warning": s.min_cells_warning,
            "max_export_rows": s.max_export_rows,
            "max_points": s.max_points,
        },
        "coverage": {"global": True, "regions": []},
        "presets": [
            {"id": p["id"], "name": p["name"], "description": p["description"], "geometry": bbox_polygon(*p["bbox"])}
            for p in PRESETS
        ],
    }
