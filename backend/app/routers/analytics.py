"""POST /calendar and POST /export/calendar.csv."""

import asyncio
import json
from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic_core import to_json

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


# At most this many /points queries run at once; the rest wait their turn without holding a worker thread.
# A month of points is a heavy DuckDB query (up to a few hundred MB while it runs). The map once sent hundreds
# of them in a second while a slider was dragged, and running them all at once exhausted the server's memory.
POINTS_SLOTS = 2
CLIENT_GONE = 499  # nginx's code for "the client closed the request"; nobody reads this response


def _points_slots(request: Request) -> asyncio.Semaphore:
    """One semaphore per app, made on first use inside its event loop."""
    state = request.app.state
    slots = getattr(state, "points_slots", None)
    if slots is None:
        slots = state.points_slots = asyncio.Semaphore(POINTS_SLOTS)
    return slots


def _points_json(data, q: PointsQuery) -> bytes:
    # pydantic-core's encoder, as FastAPI's own fast path; on the event loop jsonable_encoder took ~0.8 s per full month
    return to_json(points_service.points(data, q.geometry, q.year, q.month))


@router.post("/points", tags=["analytics"])
async def post_points(q: PointsQuery, request: Request) -> Response:
    async with _points_slots(request):
        # A request that waited may have been dropped by the browser meanwhile (the user moved on): skip its query.
        if await request.is_disconnected():
            return Response(status_code=CLIENT_GONE)
        # the query and the encoding both run in a worker thread, inside the slot: at most POINTS_SLOTS answers
        # are being built at once, and the event loop stays free for the other endpoints
        body = await run_in_threadpool(_points_json, request.app.state.data, q)
    return Response(content=body, media_type="application/json")


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
