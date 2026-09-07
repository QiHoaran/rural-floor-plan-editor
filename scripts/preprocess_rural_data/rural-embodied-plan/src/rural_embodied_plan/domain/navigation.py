"""Canonical navigation-scene models."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

from .geometry import Bounds, Direction, LineSegment, Point2D


class OpeningType(StrEnum):
    """Canonical opening types."""

    EXTERIOR_DOOR = "EXTERIOR_DOOR"
    INTERIOR_DOOR = "INTERIOR_DOOR"
    WINDOW = "WINDOW"
    OPEN_PASSAGE = "OPEN_PASSAGE"


class WallSegment(BaseModel):
    """Room-boundary wall segment with deterministic orientation metadata."""

    id: str
    source_wall_id: str
    room_id: str
    segment: LineSegment
    global_direction: Direction
    length_mm: int = Field(gt=0)
    boundary_index: int = Field(ge=0)
    opening_ids: list[str] = Field(default_factory=list)


class Opening(BaseModel):
    """A spatially located door, window, or passage."""

    id: str
    opening_type: OpeningType
    source_element_type: str
    host_wall_id: str
    room_ids: list[str]
    connects_outside: bool
    center: Point2D
    width_mm: int = Field(gt=0)
    normalized_position: float = Field(ge=0.0, le=1.0)
    global_directions: dict[str, Direction]
    room_anchors: dict[str, Point2D]
    outside_anchor: Point2D | None = None


class Door(Opening):
    """Door specialization used by callers requiring door semantics."""


class Window(Opening):
    """Window specialization used by callers requiring window semantics."""


class Room(BaseModel):
    """Canonical room geometry and semantic attributes."""

    id: str
    function: str
    display_name: str
    area_mm2: int = Field(ge=0)
    polygon: list[Point2D] = Field(min_length=3)
    bounds: Bounds
    east_west_size_mm: int = Field(ge=0)
    north_south_size_mm: int = Field(ge=0)
    wall_segment_ids: list[str]
    opening_ids: list[str]


class RoomAdjacency(BaseModel):
    """Symmetric indoor adjacency induced by one traversable opening."""

    room_a_id: str
    room_b_id: str
    opening_id: str


class NavigationScene(BaseModel):
    """Deterministic navigation-ready representation of a building."""

    schema_version: str = "0.1.0"
    building_id: str
    coordinate_unit: str = "mm"
    bounds: Bounds
    rooms: list[Room]
    wall_segments: list[WallSegment]
    openings: list[Opening]
    exterior_doors: list[str]
    interior_doors: list[str]
    room_adjacency: list[RoomAdjacency]
    warnings: list[str] = Field(default_factory=list)
