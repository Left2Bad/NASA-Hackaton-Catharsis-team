"""Settings from environment variables (see .env.example in the repository root)."""

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _env_path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    if not value:
        return default
    path = Path(value)
    return path if path.is_absolute() else (REPO / path).resolve()


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: _env_path("DATA_DIR", REPO / "data"))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip())
    )
    # DuckDB: the server has ~4 GB free, the service is capped at 3 GB (docs: PLAN, step B8)
    duckdb_memory_limit: str = field(default_factory=lambda: os.environ.get("DUCKDB_MEMORY_LIMIT", "2GB"))
    duckdb_threads: int = field(default_factory=lambda: int(os.environ.get("DUCKDB_THREADS", "2")))
    # limits published in /meta
    max_area_km2: float = 3_000_000
    min_cells_warning: int = 9
    max_export_rows: int = 500_000
    max_points: int = 20_000


def get_settings() -> Settings:
    return Settings()
