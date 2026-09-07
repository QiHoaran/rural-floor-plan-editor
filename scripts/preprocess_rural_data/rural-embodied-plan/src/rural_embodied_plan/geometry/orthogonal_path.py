"""Deterministic minimum-turn orthogonal path planning."""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from typing import cast

from shapely import Polygon
from shapely.geometry import LineString, MultiPolygon, Point
from shapely.geometry.base import BaseGeometry

from rural_embodied_plan.config import RobotConfig, RobotDynamicsConfig
from rural_embodied_plan.domain.geometry import Direction, Point2D
from rural_embodied_plan.geometry.directions import direction_between, opposite
from rural_embodied_plan.geometry.predicates import path_inside_polygon
from rural_embodied_plan.timing import movement_duration_ms, turn_duration_ms


@dataclass(frozen=True)
class _QueueState:
    point: tuple[int, int]
    heading: Direction | None


@dataclass(frozen=True)
class PathExecutionCost:
    """Physical cost of a compressed rectilinear path."""

    execution_time_ms: int
    distance_mm: int
    rotation_mdeg: int
    action_count: int


@dataclass(frozen=True)
class PlannedPath:
    """A deterministic clearance-safe path and its physical cost."""

    points: tuple[Point2D, ...]
    execution_time_ms: int
    distance_mm: int
    rotation_mdeg: int
    action_count: int


_DIRECTION_RANK = {
    Direction.NORTH: 0,
    Direction.EAST: 1,
    Direction.SOUTH: 2,
    Direction.WEST: 3,
}


def _turn_angle_mdeg(start: Direction, end: Direction) -> int:
    if start == end:
        return 0
    if opposite(start) == end:
        return 180000
    return 90000


def path_execution_cost(
    points: list[Point2D] | tuple[Point2D, ...],
    initial_heading: Direction,
    dynamics: RobotDynamicsConfig,
) -> PathExecutionCost:
    """Compute translation plus rotation time for an orthogonal point path."""

    compressed = _compress(list(points))
    distance = 0
    rotation = 0
    execution = 0
    action_count = 0
    heading = initial_heading
    for start, end in zip(compressed, compressed[1:], strict=False):
        move_heading = direction_between(start, end)
        angle = _turn_angle_mdeg(heading, move_heading)
        if angle:
            rotation += angle
            execution += turn_duration_ms(angle, dynamics.angular_speed_mdeg_per_s)
            action_count += 1
        segment_distance = abs(end.x_mm - start.x_mm) + abs(end.y_mm - start.y_mm)
        distance += segment_distance
        execution += movement_duration_ms(segment_distance, dynamics.linear_speed_mm_per_s)
        action_count += 1
        heading = move_heading
    return PathExecutionCost(
        execution_time_ms=execution,
        distance_mm=distance,
        rotation_mdeg=rotation,
        action_count=action_count,
    )


def _path_signature(points: list[Point2D]) -> tuple[tuple[int, int, int], ...]:
    return tuple(
        (_DIRECTION_RANK[direction_between(start, end)], end.x_mm, end.y_mm)
        for start, end in zip(points, points[1:], strict=False)
    )


def _timed_rank(
    points: list[Point2D], initial_heading: Direction, dynamics: RobotDynamicsConfig
) -> tuple[int, int, int, int, tuple[tuple[int, int, int], ...]]:
    cost = path_execution_cost(points, initial_heading, dynamics)
    return (
        cost.execution_time_ms,
        cost.distance_mm,
        cost.rotation_mdeg,
        cost.action_count,
        _path_signature(points),
    )


def _free_space(
    polygon: list[Point2D], clearance_mm: int, obstacles: list[list[Point2D]]
) -> BaseGeometry:
    shape = Polygon([(point.x_mm, point.y_mm) for point in polygon])
    if not shape.is_valid:
        raise ValueError("Cannot plan inside an invalid room polygon")
    free: BaseGeometry = shape.buffer(-clearance_mm, join_style="mitre")
    for obstacle in obstacles:
        blocked = Polygon([(point.x_mm, point.y_mm) for point in obstacle]).buffer(
            clearance_mm, join_style="mitre"
        )
        free = free.difference(blocked)
    return free


def _geometry_vertices(shape: BaseGeometry) -> list[Point2D]:
    if shape.geom_type == "Polygon":
        polygons = [cast(Polygon, shape)]
    elif shape.geom_type == "MultiPolygon":
        polygons = list(cast(MultiPolygon, shape).geoms)
    else:
        raise ValueError("Clearance-safe free space is not polygonal")
    vertices: set[tuple[int, int]] = set()
    for polygon in polygons:
        for x, y in polygon.exterior.coords[:-1]:
            vertices.add((round(x), round(y)))
        for ring in polygon.interiors:
            for x, y in ring.coords[:-1]:
                vertices.add((round(x), round(y)))
    return [Point2D(x_mm=x, y_mm=y) for x, y in sorted(vertices)]


def plan_rectilinear_path(
    start: Point2D,
    goal: Point2D,
    polygon: list[Point2D],
    current_heading: Direction,
    config: RobotConfig,
    obstacles: list[list[Point2D]] | None = None,
) -> PlannedPath:
    """Plan a deterministic minimum-execution-time path in eroded free space."""

    free = _free_space(polygon, config.geometry.clearance_mm, obstacles or [])
    if (
        free.is_empty
        or not free.covers(Point(start.x_mm, start.y_mm))
        or not free.covers(Point(goal.x_mm, goal.y_mm))
    ):
        raise ValueError("Start or goal is outside clearance-safe free space")
    if start == goal:
        return PlannedPath((start,), 0, 0, 0, 0)

    direct_candidates = [
        [start, Point2D(x_mm=goal.x_mm, y_mm=start.y_mm), goal],
        [start, Point2D(x_mm=start.x_mm, y_mm=goal.y_mm), goal],
    ]
    if start.x_mm == goal.x_mm or start.y_mm == goal.y_mm:
        direct_candidates.insert(0, [start, goal])
    valid = []
    for candidate in direct_candidates:
        compressed = _compress(candidate)
        line = LineString([(point.x_mm, point.y_mm) for point in compressed])
        if free.covers(line):
            valid.append(compressed)
    points = (
        min(valid, key=lambda value: _timed_rank(value, current_heading, config.dynamics))
        if valid
        else _timed_visibility_path(start, goal, free, current_heading, config.dynamics)
    )
    cost = path_execution_cost(points, current_heading, config.dynamics)
    return PlannedPath(
        points=tuple(points),
        execution_time_ms=cost.execution_time_ms,
        distance_mm=cost.distance_mm,
        rotation_mdeg=cost.rotation_mdeg,
        action_count=cost.action_count,
    )


def _timed_visibility_path(
    start: Point2D,
    goal: Point2D,
    free: BaseGeometry,
    current_heading: Direction,
    dynamics: RobotDynamicsConfig,
) -> list[Point2D]:
    vertices = [*_geometry_vertices(free), start, goal]
    xs = sorted({point.x_mm for point in vertices})
    ys = sorted({point.y_mm for point in vertices})
    nodes = [Point2D(x_mm=x, y_mm=y) for x in xs for y in ys]
    nodes = [point for point in nodes if free.covers(Point(point.x_mm, point.y_mm))]
    by_key = {(point.x_mm, point.y_mm): point for point in nodes}
    adjacency: dict[tuple[int, int], list[tuple[int, int]]] = {key: [] for key in by_key}
    keys = sorted(by_key)
    for index, left in enumerate(keys):
        for right in keys[index + 1 :]:
            if left[0] != right[0] and left[1] != right[1]:
                continue
            line = LineString([left, right])
            if free.covers(line):
                adjacency[left].append(right)
                adjacency[right].append(left)

    start_key = (start.x_mm, start.y_mm)
    goal_key = (goal.x_mm, goal.y_mm)
    queue: list[
        tuple[
            tuple[int, int, int, int, tuple[tuple[int, int, int], ...]],
            int,
            _QueueState,
            list[tuple[int, int]],
        ]
    ] = []
    sequence = 0
    initial_state = _QueueState(start_key, current_heading)
    heapq.heappush(queue, ((0, 0, 0, 0, ()), sequence, initial_state, [start_key]))
    best: dict[_QueueState, tuple[int, int, int, int, tuple[tuple[int, int, int], ...]]] = {}
    while queue:
        rank, _, state, path = heapq.heappop(queue)
        if state.point == goal_key:
            return _compress([by_key[key] for key in path])
        if state in best and best[state] <= rank:
            continue
        best[state] = rank
        assert state.heading is not None
        for neighbor in sorted(adjacency[state.point]):
            move_heading = direction_between(by_key[state.point], by_key[neighbor])
            distance = abs(neighbor[0] - state.point[0]) + abs(neighbor[1] - state.point[1])
            rotation = _turn_angle_mdeg(state.heading, move_heading)
            signature = (
                *rank[4],
                (_DIRECTION_RANK[move_heading], neighbor[0], neighbor[1]),
            )
            next_rank = (
                rank[0]
                + movement_duration_ms(distance, dynamics.linear_speed_mm_per_s)
                + turn_duration_ms(rotation, dynamics.angular_speed_mdeg_per_s),
                rank[1] + distance,
                rank[2] + rotation,
                rank[3] + 1 + int(rotation > 0),
                signature,
            )
            sequence += 1
            heapq.heappush(
                queue,
                (
                    next_rank,
                    sequence,
                    _QueueState(neighbor, move_heading),
                    [*path, neighbor],
                ),
            )
    raise ValueError("No rectilinear path exists in clearance-safe free space")


def _compress(points: list[Point2D]) -> list[Point2D]:
    result: list[Point2D] = []
    for point in points:
        if result and point == result[-1]:
            continue
        if len(result) >= 2:
            a, b = result[-2], result[-1]
            if (a.x_mm == b.x_mm == point.x_mm) or (a.y_mm == b.y_mm == point.y_mm):
                result[-1] = point
                continue
        result.append(point)
    return result


def orthogonal_path(
    start: Point2D,
    goal: Point2D,
    polygon: list[Point2D],
    current_heading: Direction | None = None,
) -> list[Point2D]:
    """Plan a valid path, minimizing turns then length with stable tie-breaks."""

    if start == goal:
        return [start]
    candidates = [
        [start, Point2D(x_mm=goal.x_mm, y_mm=start.y_mm), goal],
        [start, Point2D(x_mm=start.x_mm, y_mm=goal.y_mm), goal],
    ]
    if start.x_mm == goal.x_mm or start.y_mm == goal.y_mm:
        candidates.insert(0, [start, goal])
    valid = [
        _compress(path) for path in candidates if path_inside_polygon(_compress(path), polygon)
    ]
    if valid:
        return min(valid, key=lambda path: _path_rank(path, current_heading))
    return _visibility_path(start, goal, polygon, current_heading)


def _path_rank(path: list[Point2D], heading: Direction | None) -> tuple[int, int, int, int]:
    directions = [direction_between(a, b) for a, b in zip(path, path[1:], strict=False)]
    turns = sum(left != right for left, right in zip(directions, directions[1:], strict=False))
    length = sum(
        abs(a.x_mm - b.x_mm) + abs(a.y_mm - b.y_mm) for a, b in zip(path, path[1:], strict=False)
    )
    heading_penalty = int(bool(directions and heading is not None and directions[0] != heading))
    first_axis_penalty = int(
        bool(directions and directions[0] in {Direction.NORTH, Direction.SOUTH})
    )
    return turns, length, heading_penalty, first_axis_penalty


def _visibility_path(
    start: Point2D,
    goal: Point2D,
    polygon: list[Point2D],
    current_heading: Direction | None,
) -> list[Point2D]:
    xs = sorted({point.x_mm for point in [*polygon, start, goal]})
    ys = sorted({point.y_mm for point in [*polygon, start, goal]})
    nodes = [Point2D(x_mm=x, y_mm=y) for x in xs for y in ys]
    nodes = [point for point in nodes if path_inside_polygon([point], polygon)]
    by_key = {(point.x_mm, point.y_mm): point for point in nodes}
    adjacency: dict[tuple[int, int], list[tuple[int, int]]] = {key: [] for key in by_key}
    keys = sorted(by_key)
    for index, left in enumerate(keys):
        for right in keys[index + 1 :]:
            if left[0] != right[0] and left[1] != right[1]:
                continue
            if path_inside_polygon([by_key[left], by_key[right]], polygon):
                adjacency[left].append(right)
                adjacency[right].append(left)
    start_key = (start.x_mm, start.y_mm)
    goal_key = (goal.x_mm, goal.y_mm)
    queue: list[tuple[tuple[int, int, int, int], int, _QueueState, list[tuple[int, int]]]] = []
    sequence = 0
    heapq.heappush(
        queue, ((0, 0, 0, 0), sequence, _QueueState(start_key, current_heading), [start_key])
    )
    best: dict[_QueueState, tuple[int, int, int, int]] = {}
    while queue:
        cost, _, state, path = heapq.heappop(queue)
        if state.point == goal_key:
            return _compress([by_key[key] for key in path])
        if state in best and best[state] <= cost:
            continue
        best[state] = cost
        for neighbor in sorted(adjacency[state.point]):
            move_direction = direction_between(by_key[state.point], by_key[neighbor])
            distance = abs(neighbor[0] - state.point[0]) + abs(neighbor[1] - state.point[1])
            turn_cost = int(state.heading is not None and state.heading != move_direction)
            heading_penalty = int(
                len(path) == 1 and current_heading is not None and current_heading != move_direction
            )
            axis_penalty = int(
                len(path) == 1 and move_direction in {Direction.NORTH, Direction.SOUTH}
            )
            next_cost = (
                cost[0] + turn_cost,
                cost[1] + distance,
                cost[2] + heading_penalty,
                cost[3] + axis_penalty,
            )
            sequence += 1
            heapq.heappush(
                queue,
                (next_cost, sequence, _QueueState(neighbor, move_direction), [*path, neighbor]),
            )
    raise ValueError("No orthogonal path exists inside the room polygon")
