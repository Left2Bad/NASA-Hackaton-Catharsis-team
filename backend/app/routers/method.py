"""GET /method/validation: the validation report of the harmonization, served as written by the pipeline."""

from fastapi import APIRouter, Request
from fastapi.responses import Response

from ..errors import ApiError

router = APIRouter(tags=["method"])


@router.get("/method/validation")
def method_validation(request: Request) -> Response:
    report = request.app.state.data.validation_report()
    if report is None:
        raise ApiError("NO_DATA", "Отчёт проверки ещё не построен: запустите pipeline/validation.py")
    return Response(report, media_type="application/json")
