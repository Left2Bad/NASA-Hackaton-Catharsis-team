"""POST /calendar and POST /export/calendar.csv."""

import json
from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Request
from fastapi.responses import Response

from .. import calendar_service
from ..schemas import AreaQuery

router = APIRouter()

_CACHE: OrderedDict[str, dict] = OrderedDict()
_CACHE_SIZE = 200
_LOCK = Lock()


def cached_calendar(request: Request, q: AreaQuery) -> dict:
    data = request.app.state.data
    key = data.data_version + json.dumps(q.model_dump(), sort_keys=True)
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    payload = calendar_service.build(data, q)
    with _LOCK:
        _CACHE[key] = payload
        if len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return payload


@router.post("/calendar", tags=["analytics"])
def post_calendar(q: AreaQuery, request: Request) -> dict:
    return cached_calendar(request, q)


@router.post("/export/calendar.csv", tags=["export"])
def export_calendar(q: AreaQuery, request: Request) -> Response:
    payload = cached_calendar(request, q)
    return Response(
        content=calendar_service.to_csv(payload),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="calendar.csv"'},
    )
