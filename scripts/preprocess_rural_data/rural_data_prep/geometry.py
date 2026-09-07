"""Geometry repair, predicates, and deterministic derived measurements."""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable


@dataclass(frozen=True)
class GeometryRepairResult:
    vertices: dict[str, dict[str, Any]]
    repairs: list[dict[str, Any]]
    repaired_wall_ids: list[str]


class _DisjointSet:
    def __init__(self, values: Iterable[str]) -> None:
        self.parent = {value: value for value in values}

    def find(self, value: str) -> str:
        parent = self.parent[value]
        if parent != value:
            self.parent[value] = self.find(parent)
        return self.parent[value]

    def union(self, first: str, second: str) -> None:
        first_root = self.find(first)
        second_root = self.find(second)
        if first_root == second_root:
            return
        low, high = sorted((first_root, second_root))
        self.parent[high] = low

    def groups(self) -> list[list[str]]:
        grouped: dict[str, list[str]] = {}
        for value in sorted(self.parent):
            grouped.setdefault(self.find(value), []).append(value)
        return [grouped[key] for key in sorted(grouped)]


def round_half_up(value: float | Decimal) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _median_integer(values: list[int]) -> int:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return round_half_up(Decimal(ordered[middle - 1] + ordered[middle]) / Decimal(2))


def repair_near_axis_geometry(
    vertices: dict[str, dict[str, Any]],
    walls: dict[str, dict[str, Any]],
    *,
    max_short_axis_mm: int = 250,
    min_aspect_ratio: float = 16.0,
) -> GeometryRepairResult:
    """Snap exact and qualifying near-axis wall constraints to integer medians."""

    repaired = copy.deepcopy(vertices)
    x_constraints = _DisjointSet(vertices)
    y_constraints = _DisjointSet(vertices)
    candidate_ids: list[str] = []
    for wall_id in sorted(walls):
        wall = walls[wall_id]
        start_id = wall.get("start_vertex_id")
        end_id = wall.get("end_vertex_id")
        if start_id not in vertices or end_id not in vertices:
            continue
        start = vertices[start_id]
        end = vertices[end_id]
        dx = abs(int(end["x_mm"]) - int(start["x_mm"]))
        dy = abs(int(end["y_mm"]) - int(start["y_mm"]))
        if dx == 0:
            x_constraints.union(start_id, end_id)
            continue
        if dy == 0:
            y_constraints.union(start_id, end_id)
            continue
        short_axis = min(dx, dy)
        long_axis = max(dx, dy)
        if short_axis <= max_short_axis_mm and long_axis / short_axis >= min_aspect_ratio:
            candidate_ids.append(wall_id)
            if dy > dx:
                x_constraints.union(start_id, end_id)
            else:
                y_constraints.union(start_id, end_id)

    for coordinate, constraints in (("x_mm", x_constraints), ("y_mm", y_constraints)):
        for group in constraints.groups():
            target = _median_integer([int(vertices[vertex_id][coordinate]) for vertex_id in group])
            for vertex_id in group:
                repaired[vertex_id][coordinate] = target

    incident: dict[str, list[str]] = {vertex_id: [] for vertex_id in vertices}
    for wall_id, wall in walls.items():
        for endpoint in (wall.get("start_vertex_id"), wall.get("end_vertex_id")):
            if endpoint in incident:
                incident[endpoint].append(wall_id)

    repairs: list[dict[str, Any]] = []
    for vertex_id in sorted(vertices):
        before = vertices[vertex_id]
        after = repaired[vertex_id]
        if before.get("x_mm") == after.get("x_mm") and before.get("y_mm") == after.get("y_mm"):
            continue
        if any(
            abs(int(after[coordinate]) - int(before[coordinate])) > max_short_axis_mm
            for coordinate in ("x_mm", "y_mm")
        ):
            raise ValueError(
                f"Global near-axis constraint for vertex {vertex_id} exceeds {max_short_axis_mm} mm"
            )
        repairs.append(
            {
                "rule": "near_axis_global_median_v1",
                "vertex_id": vertex_id,
                "before_mm": [int(before["x_mm"]), int(before["y_mm"])],
                "after_mm": [int(after["x_mm"]), int(after["y_mm"])],
                "delta_mm": [
                    int(after["x_mm"]) - int(before["x_mm"]),
                    int(after["y_mm"]) - int(before["y_mm"]),
                ],
                "related_wall_ids": sorted(incident[vertex_id]),
            }
        )
    return GeometryRepairResult(
        vertices=repaired,
        repairs=repairs,
        repaired_wall_ids=sorted(candidate_ids),
    )


def derive_polygon(
    vertex_ids: list[str], vertices: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    points = [(int(vertices[vertex_id]["x_mm"]), int(vertices[vertex_id]["y_mm"])) for vertex_id in vertex_ids]
    if len(points) < 3:
        raise ValueError("Polygon requires at least three vertices")
    area2 = 0
    centroid_x_numerator = 0
    centroid_y_numerator = 0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        area2 += cross
        centroid_x_numerator += (x1 + x2) * cross
        centroid_y_numerator += (y1 + y2) * cross
    if area2 == 0:
        raise ValueError("Polygon area is zero")
    area: int | float = abs(area2) // 2 if abs(area2) % 2 == 0 else abs(area2) / 2
    centroid_x = round_half_up(Decimal(centroid_x_numerator) / Decimal(3 * area2))
    centroid_y = round_half_up(Decimal(centroid_y_numerator) / Decimal(3 * area2))
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return {
        "bbox_mm": [min(xs), min(ys), max(xs), max(ys)],
        "area_mm2": area,
        "centroid_mm": [centroid_x, centroid_y],
        "orientation": "ccw" if area2 > 0 else "cw",
    }


def wall_length_mm(
    wall: dict[str, Any], vertices: dict[str, dict[str, Any]]
) -> float:
    start = vertices[wall["start_vertex_id"]]
    end = vertices[wall["end_vertex_id"]]
    return math.hypot(int(end["x_mm"]) - int(start["x_mm"]), int(end["y_mm"]) - int(start["y_mm"]))


def _cross(first: tuple[int, int], second: tuple[int, int], third: tuple[int, int]) -> int:
    return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])


def _on_segment(first: tuple[int, int], point: tuple[int, int], second: tuple[int, int]) -> bool:
    return (
        min(first[0], second[0]) <= point[0] <= max(first[0], second[0])
        and min(first[1], second[1]) <= point[1] <= max(first[1], second[1])
    )


def _segments_intersect(
    first_start: tuple[int, int],
    first_end: tuple[int, int],
    second_start: tuple[int, int],
    second_end: tuple[int, int],
) -> bool:
    values = (
        _cross(first_start, first_end, second_start),
        _cross(first_start, first_end, second_end),
        _cross(second_start, second_end, first_start),
        _cross(second_start, second_end, first_end),
    )
    if values[0] * values[1] < 0 and values[2] * values[3] < 0:
        return True
    return any(
        cross == 0 and _on_segment(start, point, end)
        for cross, start, point, end in (
            (values[0], first_start, second_start, first_end),
            (values[1], first_start, second_end, first_end),
            (values[2], second_start, first_start, second_end),
            (values[3], second_start, first_end, second_end),
        )
    )


def _polygon_self_intersects(points: list[tuple[int, int]]) -> bool:
    edge_count = len(points)
    for first in range(edge_count):
        first_next = (first + 1) % edge_count
        for second in range(first + 1, edge_count):
            second_next = (second + 1) % edge_count
            if first == second or first_next == second or second_next == first:
                continue
            if _segments_intersect(
                points[first], points[first_next], points[second], points[second_next]
            ):
                return True
    return False


def validate_geometry(
    vertices: dict[str, dict[str, Any]],
    walls: dict[str, dict[str, Any]],
    faces: dict[str, dict[str, Any]],
) -> list[str]:
    """Return deterministic structural geometry issues without filtering records."""

    issues: list[str] = []
    coordinate_ids: dict[tuple[int, int], list[str]] = {}
    for vertex_id in sorted(vertices):
        vertex = vertices[vertex_id]
        coordinate_ids.setdefault(
            (int(vertex["x_mm"]), int(vertex["y_mm"])), []
        ).append(vertex_id)
    for coordinate, vertex_ids in sorted(coordinate_ids.items()):
        if len(vertex_ids) > 1:
            issues.append(
                f"Vertices {', '.join(vertex_ids)} share coordinates {list(coordinate)}"
            )
    for wall_id in sorted(walls):
        wall = walls[wall_id]
        start_id = wall.get("start_vertex_id")
        end_id = wall.get("end_vertex_id")
        if start_id not in vertices or end_id not in vertices:
            issues.append(f"Wall {wall_id} references a missing vertex")
            continue
        start = vertices[start_id]
        end = vertices[end_id]
        if start.get("x_mm") == end.get("x_mm") and start.get("y_mm") == end.get("y_mm"):
            issues.append(f"Wall {wall_id} is degenerate")
    for face_id in sorted(faces):
        ids = faces[face_id].get("boundary_vertex_ids")
        if not isinstance(ids, list) or len(ids) < 3:
            issues.append(f"Face {face_id} has fewer than three vertices")
            continue
        if any(vertex_id not in vertices for vertex_id in ids):
            issues.append(f"Face {face_id} references a missing vertex")
            continue
        points = [(int(vertices[vertex_id]["x_mm"]), int(vertices[vertex_id]["y_mm"])) for vertex_id in ids]
        if len(set(points)) != len(points):
            issues.append(f"Face {face_id} contains collapsed vertices")
            continue
        if _polygon_self_intersects(points):
            issues.append(f"Face {face_id} self-intersects")
            continue
        try:
            derive_polygon(ids, vertices)
        except ValueError as error:
            issues.append(f"Face {face_id}: {error}")
    return issues
