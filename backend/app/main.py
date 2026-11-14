"""Burn Calendar API (contract/openapi.yaml). Run: uvicorn app.main:app --port 8000 (from backend/)."""

from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import errors
from .data import Data
from .routers import analytics, method, service
from .settings import REPO, Settings, get_settings

API_PREFIX = "/api/v1"
CONTRACT = REPO / "contract" / "openapi.yaml"
SPILL_LIMIT = "4GB"  # DuckDB temp files (large export sorts) may not fill the server's disk


def contract_openapi(path: Path = CONTRACT) -> dict | None:
    """contract/openapi.yaml as the app's OpenAPI document, its server set to this app's prefix.

    The contract is the source of truth for response shapes and error codes, so /docs shows it rather than
    a schema generated from the routes (which would list 422 errors the API never sends and untyped bodies).
    """
    if not path.exists():
        return None
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    spec["servers"] = [{"url": API_PREFIX, "description": "This server"}]
    return spec


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.data = Data(settings)
        app.state.data.con.execute(f"SET max_temp_directory_size = '{SPILL_LIMIT}'")
        yield

    app = FastAPI(title="Burn Calendar API", version="0.2.0", lifespan=lifespan, docs_url=f"{API_PREFIX}/docs",
                  openapi_url=f"{API_PREFIX}/openapi.json")  # fmt: skip
    spec = contract_openapi()
    if spec is not None:
        app.openapi = lambda: spec
    # GuardMiddleware first, so CORSMiddleware (added later, hence outer) also wraps its 400 and 500 responses
    app.add_middleware(errors.GuardMiddleware)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )
    errors.install(app)
    app.include_router(service.router, prefix=API_PREFIX)
    app.include_router(analytics.router, prefix=API_PREFIX)
    app.include_router(method.router, prefix=API_PREFIX)
    return app


app = create_app()
