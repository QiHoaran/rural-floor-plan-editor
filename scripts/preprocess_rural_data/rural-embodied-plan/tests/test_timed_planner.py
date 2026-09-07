"""Minimum-execution-time rectilinear planner tests."""

import pytest

from rural_embodied_plan.config import default_robot_config_path, load_robot_config
from rural_embodied_plan.domain.geometry import Direction, Point2D
from rural_embodied_plan.geometry.orthogonal_path import (
    path_execution_cost,
    plan_rectilinear_path,
)


def _rectangle() -> list[Point2D]:
    return [
        Point2D(x_mm=0, y_mm=0),
        Point2D(x_mm=4000, y_mm=0),
        Point2D(x_mm=4000, y_mm=3000),
        Point2D(x_mm=0, y_mm=3000),
    ]


def test_path_cost_optimizes_execution_time_not_distance_alone() -> None:
    dynamics = load_robot_config(default_robot_config_path()).dynamics
    shorter_with_turns = [
        Point2D(x_mm=0, y_mm=0),
        Point2D(x_mm=0, y_mm=500),
        Point2D(x_mm=1000, y_mm=500),
        Point2D(x_mm=1000, y_mm=1000),
        Point2D(x_mm=2000, y_mm=1000),
    ]
    longer_with_fewer_turns = [
        Point2D(x_mm=0, y_mm=0),
        Point2D(x_mm=2200, y_mm=0),
        Point2D(x_mm=2200, y_mm=1000),
        Point2D(x_mm=2000, y_mm=1000),
    ]

    shorter = path_execution_cost(shorter_with_turns, Direction.EAST, dynamics)
    longer = path_execution_cost(longer_with_fewer_turns, Direction.EAST, dynamics)

    assert shorter.distance_mm < longer.distance_mm
    assert longer.execution_time_ms < shorter.execution_time_ms


def test_path_cost_matches_per_action_ceiling_timing() -> None:
    dynamics = load_robot_config(default_robot_config_path()).dynamics.model_copy(
        update={"linear_speed_mm_per_s": 3000}
    )
    points = [
        Point2D(x_mm=0, y_mm=0),
        Point2D(x_mm=1, y_mm=0),
        Point2D(x_mm=1, y_mm=1),
    ]

    cost = path_execution_cost(points, Direction.EAST, dynamics)

    assert cost.execution_time_ms == 1002


def test_planner_rejects_points_outside_clearance_eroded_space() -> None:
    config = load_robot_config(default_robot_config_path())

    with pytest.raises(ValueError, match="clearance-safe free space"):
        plan_rectilinear_path(
            Point2D(x_mm=100, y_mm=100),
            Point2D(x_mm=3000, y_mm=1000),
            _rectangle(),
            Direction.EAST,
            config,
        )


def test_planner_is_stable_and_prefers_current_heading() -> None:
    config = load_robot_config(default_robot_config_path())
    start = Point2D(x_mm=300, y_mm=300)
    goal = Point2D(x_mm=3700, y_mm=2700)

    first = plan_rectilinear_path(start, goal, _rectangle(), Direction.EAST, config)
    second = plan_rectilinear_path(start, goal, _rectangle(), Direction.EAST, config)

    assert first == second
    assert first.points[1].y_mm == start.y_mm
    assert first.execution_time_ms == 6800
