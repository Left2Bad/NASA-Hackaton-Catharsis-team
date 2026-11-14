"""POST /calendar and POST /export/calendar.csv."""

import json
from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

from .. import calendar_service, daily_service, points_service
from ..schemas import AreaQuery, DailyQuery, ExportPointsQuery, PointsQuery

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


@router.post("/current", tags=["analytics"])
def post_current(q: AreaQuery, request: Request) -> dict:
    return daily_service.current(request.app.state.data, q)


@router.post("/daily", tags=["analytics"])
def post_daily(q: DailyQuery, request: Request) -> dict:
    return daily_service.daily(request.app.state.data, q)


@router.post("/points", tags=["analytics"])
def post_points(q: PointsQuery, request: Request) -> dict:
    return points_service.points(request.app.state.data, q.geometry, q.year, q.month)


@router.post("/export/points.csv", tags=["export"])
def export_points(q: ExportPointsQuery, request: Request) -> StreamingResponse:
    export = points_service.Export(request.app.state.data, q.geometry, q.start_date, q.end_date)  # 400/404/413 here
    return StreamingResponse(
        export.rows(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="hotspots.csv"'},
    )


@router.post("/export/calendar.csv", tags=["export"])
def export_calendar(q: AreaQuery, request: Request) -> Response:
    payload = cached_calendar(request, q)
    return Response(
        content=calendar_service.to_csv(payload),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="calendar.csv"'},
    )
