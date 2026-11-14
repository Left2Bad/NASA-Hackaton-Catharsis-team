"""API errors in the contract format: {"error": {"code": ..., "message": ...}}."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

STATUS = {
    "INVALID_GEOMETRY": 400,
    "INVALID_REQUEST": 400,
    "NO_DATA": 404,
    "AREA_TOO_LARGE": 413,
    "EXPORT_TOO_LARGE": 413,
    "INTERNAL": 500,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(error_body(exc.code, exc.message), status_code=STATUS[exc.code])

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = (
            f"Некорректный запрос: {where} — {first.get('msg', 'ошибка проверки')}" if where else "Некорректный запрос"
        )
        return JSONResponse(error_body("INVALID_REQUEST", message), status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = "NO_DATA" if exc.status_code == 404 else "INVALID_REQUEST" if exc.status_code < 500 else "INTERNAL"
        return JSONResponse(error_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception):
        return JSONResponse(error_body("INTERNAL", "Внутренняя ошибка сервера"), status_code=500)
