"""Burn Calendar API (contract/openapi.yaml). Run: uvicorn app.main:app --port 8000 (from backend/)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import errors
from .data import Data
from .routers import analytics, service
from .settings import Settings, get_settings

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.data = Data(settings)
        yield

    app = FastAPI(title="Burn Calendar API", version="0.2.0", lifespan=lifespan, docs_url=f"{API_PREFIX}/docs",
                  openapi_url=f"{API_PREFIX}/openapi.json")  # fmt: skip
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
    return app


app = create_app()
