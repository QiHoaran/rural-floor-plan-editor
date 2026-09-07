"""Deterministic north-up projection into a padded 256-square grid."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from .geometry import round_half_up


Point = tuple[float, float]


def _xy(point: Any) -> Point:
    if isinstance(point, dict):
        return float(point["x_mm"]), float(point["y_mm"])
    return float(point[0]), float(point[1])


def _rotate(point: Point, degrees: float) -> Point:
    if degrees == 0:
        return point
    radians = math.radians(degrees)
    cosine = math.cos(radians)
    sine = math.sin(radians)
    return point[0] * cosine - point[1] * sine, point[0] * sine + point[1] * cosine


@dataclass(frozen=True)
class GridTransform:
    rotation_deg: float
    source_bbox_mm: tuple[float, float, float, float]
    rotated_bbox_mm: tuple[float, float, float, float]
    scale_mm_to_grid: float
    offset_grid: tuple[float, float]
    grid_size: int = 256
    padding: int = 8

    @classmethod
    def from_vertices(
        cls,
        vertices: dict[str, dict[str, Any]],
        *,
        north_angle_deg: float = 0,
        grid_size: int = 256,
        padding: int = 8,
    ) -> "GridTransform":
        if not vertices:
            raise ValueError("Cannot project an empty vertex set")
        source_points = [_xy(vertices[key]) for key in sorted(vertices)]
        source_x = [point[0] for point in source_points]
        source_y = [point[1] for point in source_points]
        rotation = -float(north_angle_deg)
        rotated = [_rotate(point, rotation) for point in source_points]
        xs = [point[0] for point in rotated]
        ys = [point[1] for point in rotated]
        min_x, min_y, max_x, max_y = min(xs), min(ys), max(xs), max(ys)
        width = max_x - min_x
        height = max_y - min_y
        if width <= 0 or height <= 0:
            raise ValueError("Projected building bbox must have positive width and height")
        usable_span = grid_size - 1 - 2 * padding
        scale = min(usable_span / width, usable_span / height)
        scaled_width = width * scale
        scaled_height = height * scale
        offset_x = padding + (usable_span - scaled_width) / 2 - min_x * scale
        offset_y = padding + (usable_span - scaled_height) / 2 - min_y * scale
        return cls(
            rotation_deg=rotation,
            source_bbox_mm=(min(source_x), min(source_y), max(source_x), max(source_y)),
            rotated_bbox_mm=(min_x, min_y, max_x, max_y),
            scale_mm_to_grid=scale,
            offset_grid=(offset_x, offset_y),
            grid_size=grid_size,
            padding=padding,
        )

    def forward_float(self, point: Any) -> Point:
        rotated_x, rotated_y = _rotate(_xy(point), self.rotation_deg)
        return (
            rotated_x * self.scale_mm_to_grid + self.offset_grid[0],
            rotated_y * self.scale_mm_to_grid + self.offset_grid[1],
        )

    def forward(self, point: Any) -> list[int]:
        x, y = self.forward_float(point)
        return [round_half_up(x), round_half_up(y)]

    def inverse(self, point: Sequence[float]) -> Point:
        rotated = (
            (float(point[0]) - self.offset_grid[0]) / self.scale_mm_to_grid,
            (float(point[1]) - self.offset_grid[1]) / self.scale_mm_to_grid,
        )
        return _rotate(rotated, -self.rotation_deg)

    def as_dict(self) -> dict[str, Any]:
        rounded = lambda value: round(value, 12)
        return {
            "grid_size": self.grid_size,
            "padding": self.padding,
            "rotation_deg": rounded(self.rotation_deg),
            "source_bbox_mm": [rounded(value) for value in self.source_bbox_mm],
            "rotated_bbox_mm": [rounded(value) for value in self.rotated_bbox_mm],
            "scale_mm_to_grid": rounded(self.scale_mm_to_grid),
            "offset_grid": [rounded(value) for value in self.offset_grid],
            "rounding": "half_up",
        }


def _signed_area2(points: Sequence[Sequence[int]]) -> int:
    return sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )


def normalize_polygon(points: Iterable[Sequence[int]]) -> list[list[int]]:
    """Return a CCW polygon rotated to its lexicographically smallest point."""

    normalized = [[int(point[0]), int(point[1])] for point in points]
    if len(normalized) < 3:
        raise ValueError("Polygon requires at least three points")
    if _signed_area2(normalized) == 0:
        raise ValueError("Projected polygon area is zero")
    if _signed_area2(normalized) < 0:
        normalized.reverse()
    start_index = min(range(len(normalized)), key=lambda index: tuple(normalized[index]))
    return normalized[start_index:] + normalized[:start_index]
