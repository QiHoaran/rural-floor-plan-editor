"""Primitive integer-millimetre geometry models."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, model_validator


class Direction(StrEnum):
    """Allowed global cardinal directions."""

    NORTH = "NORTH"
    EAST = "EAST"
    SOUTH = "SOUTH"
    WEST = "WEST"


class RelativeDirection(StrEnum):
    """Direction relative to a robot heading."""

    FRONT = "FRONT"
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    BACK = "BACK"


class Point2D(BaseModel):
    """An integer point in local millimetres."""

    x_mm: int
    y_mm: int


class LineSegment(BaseModel):
    """A non-zero horizontal or vertical line segment."""

    start: Point2D
    end: Point2D

    @model_validator(mode="after")
    def validate_orthogonal(self) -> LineSegment:
        """Reject zero-length and diagonal segments."""

        if self.start == self.end:
            raise ValueError("Line segment must have positive length")
        if self.start.x_mm != self.end.x_mm and self.start.y_mm != self.end.y_mm:
            raise ValueError("Only horizontal or vertical segments are supported")
        return self

    @property
    def length_mm(self) -> int:
        """Return Manhattan length, equal to Euclidean length for orthogonal segments."""

        return abs(self.end.x_mm - self.start.x_mm) + abs(self.end.y_mm - self.start.y_mm)


class Bounds(BaseModel):
    """Axis-aligned integer bounds."""

    min_x_mm: int
    min_y_mm: int
    max_x_mm: int
    max_y_mm: int
