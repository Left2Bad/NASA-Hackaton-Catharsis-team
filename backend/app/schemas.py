"""Request bodies (contract/openapi.yaml, components.schemas). Responses are plain dicts checked by tests."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class YearRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_year: int = Field(ge=2000)
    end_year: int = Field(ge=2000)


class AreaQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    geometry: dict
    start_year: int | None = Field(default=None, ge=2000)
    end_year: int | None = Field(default=None, ge=2000)
    baseline: YearRange | None = None
    metric: Literal["count", "frp"] = "count"
    series: Literal["harmonized", "raw"] = "harmonized"


class DailyQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    geometry: dict
    year: int = Field(ge=2000)
    metric: Literal["count", "frp"] = "count"


class PointsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    geometry: dict
    year: int = Field(ge=2000)
    month: int = Field(ge=1, le=12)


class ExportPointsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    geometry: dict
    start_date: dt.date
    end_date: dt.date


PRESETS = [
    {
        "id": "kz-steppe",
        "name": "Northern Kazakhstan",
        "description": "Steppe and cropland burning in spring and late summer",
        "bbox": (61.0, 51.0, 71.0, 55.0),
    },
    {
        "id": "amazon-south",
        "name": "Southern Amazon",
        "description": "Burning season in August and September",
        "bbox": (-62.0, -13.0, -52.0, -7.0),
    },
    {
        "id": "california-north",
        "name": "Northern California",
        "description": "Large wildfires in summer and autumn",
        "bbox": (-124.0, 38.5, -120.0, 42.0),
    },
]


def bbox_polygon(west: float, south: float, east: float, north: float) -> dict:
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}
