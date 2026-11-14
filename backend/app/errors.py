"""API errors in the contract format: {"error": {"code": ..., "message": ...}}."""

import json
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger("app")

STATUS = {
    "INVALID_GEOMETRY": 400,
    "INVALID_REQUEST": 400,
    "NO_DATA": 404,
    "AREA_TOO_LARGE": 413,
    "EXPORT_TOO_LARGE": 413,
    "INTERNAL": 500,
}
MAX_BODY_BYTES = 1_000_000  # an area of MAX_VERTICES vertices is about 0.2 MB of GeoJSON


class ApiError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


class _BodyTooLarge(Exception):
    pass


class GuardMiddleware:
    """Innermost user middleware: request body limit and the INTERNAL error response.

    Starlette runs the handler registered for bare Exception in ServerErrorMiddleware, which sits outside
    CORSMiddleware, so a 500 lost its CORS headers and the browser reported a network error. This middleware
    is added before CORSMiddleware, so CORS wraps it and every error, the 500 included, carries the headers.
    """

    def __init__(self, app: ASGIApp, max_body: int = MAX_BODY_BYTES):
        self.app = app
        self.max_body = max_body

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False
        received = 0

        async def guarded_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body:
                    raise _BodyTooLarge
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        length = dict(scope.get("headers") or []).get(b"content-length")
        try:
            if length is not None and length.isdigit() and int(length) > self.max_body:
                raise _BodyTooLarge
            await self.app(scope, guarded_receive, tracked_send)
        except _BodyTooLarge:
            if started:
                raise
            msg = f"The request body is larger than {self.max_body // 1_000_000} MB."
            await _send_json(send, 400, error_body("INVALID_REQUEST", msg))
        except Exception:
            log.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:  # a streamed body was already under way; nothing valid can be sent any more
                raise
            await _send_json(send, 500, error_body("INTERNAL", "Internal server error"))


async def _send_json(send: Send, status: int, body: dict) -> None:
    data = json.dumps(body).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": data})


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(error_body(exc.code, exc.message), status_code=STATUS[exc.code])

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = f"Invalid request: {where} — {first.get('msg', 'validation error')}" if where else "Invalid request"
        return JSONResponse(error_body("INVALID_REQUEST", message), status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = "NO_DATA" if exc.status_code == 404 else "INVALID_REQUEST" if exc.status_code < 500 else "INTERNAL"
        return JSONResponse(error_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception):  # last resort, outside CORS (see GuardMiddleware)
        return JSONResponse(error_body("INTERNAL", "Internal server error"), status_code=500)
