"""Pydantic models for board data structures."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ElementType(str, Enum):
    IMAGE = "image"
    TEXT = "text"
    RECTANGLE = "rectangle"
    ARROW = "arrow"
    GROUP = "group"


class ImageMode(str, Enum):
    EXACT = "exact"
    RELATIVE = "relative"
    GLOB = "glob"


class FitMode(str, Enum):
    CONTAIN = "contain"
    COVER = "cover"
    FILL = "fill"
    NONE = "none"


class StrokeStyle(str, Enum):
    SOLID = "solid"
    DASHED = "dashed"
    DOTTED = "dotted"


class ElementStyle(BaseModel):
    borderColor: Optional[str] = None
    borderWidth: Optional[float] = None
    borderRadius: Optional[float] = None
    shadow: Optional[str] = None
    background: Optional[str] = None
    fitMode: Optional[FitMode] = None
    fontSize: Optional[float] = None
    fontWeight: Optional[str] = None
    color: Optional[str] = None
    padding: Optional[float] = None
    textAlign: Optional[str] = None
    strokeColor: Optional[str] = None
    strokeWidth: Optional[float] = None
    strokeStyle: Optional[StrokeStyle] = None
    fill: Optional[str] = None
    opacity: Optional[float] = None
    lineHeight: Optional[float] = None
    fontFamily: Optional[str] = None


class ImageSource(BaseModel):
    mode: ImageMode = ImageMode.EXACT
    path: str
    followLatest: bool = False
    autoRefresh: bool = False
    pinnedPath: Optional[str] = None


class CropRegion(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(gt=0.0, le=1.0)
    height: float = Field(gt=0.0, le=1.0)


class ArrowConfig(BaseModel):
    startArrow: bool = False
    endArrow: bool = True


class BoardElement(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: ElementType
    x: float = 0.0
    y: float = 0.0
    width: float = 200.0
    height: float = 200.0
    z_index: int = 0
    locked: bool = False
    visible: bool = True
    rotation: float = 0.0
    style: ElementStyle = Field(default_factory=ElementStyle)
    source: Optional[ImageSource] = None
    crop: Optional[CropRegion] = None
    text: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    children: Optional[list[str]] = None
    points: Optional[list[dict[str, float]]] = None
    arrow: Optional[ArrowConfig] = None


class CanvasSettings(BaseModel):
    width: int = 2400
    height: int = 1600
    infinite: bool = True
    background: str = "#ffffff"
    grid_enabled: bool = True
    grid_size: int = 20
    snap_enabled: bool = True
    snap_size: int = 10


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Board(BaseModel):
    schema_version: int = 1
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Untitled Board"
    canvas: CanvasSettings = Field(default_factory=CanvasSettings)
    elements: list[BoardElement] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    app_version: str = "0.1.0"


class WorkspaceConfig(BaseModel):
    recent_boards: list[str] = Field(default_factory=list)
    watched_roots: list[str] = Field(default_factory=list)
    allowed_roots: list[str] = Field(default_factory=list)
    default_export_dpi: int = 150
