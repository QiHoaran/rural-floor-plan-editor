"""Timed trajectory state transition tests."""

import pytest

from rural_embodied_plan.domain.geometry import Direction, Point2D
from rural_embodied_plan.domain.robot import (
    RobotActionType,
    TimedRobotAction,
    TimedRobotState,
    TraversalPhase,
)
from rural_embodied_plan.traversal.state_machine import TimedStateMachine


def _initial() -> TimedRobotState:
    return TimedRobotState(
        position=Point2D(x_mm=0, y_mm=0),
        heading=Direction.NORTH,
        phase=TraversalPhase.OUTSIDE,
    )


def test_timed_events_are_contiguous_and_use_executing_phase() -> None:
    machine = TimedStateMachine(_initial())

    machine.emit(
        action=TimedRobotAction(type=RobotActionType.TURN_RIGHT, turn_angle_mdeg=90000),
        duration_ms=1000,
        updates={"heading": Direction.EAST},
        phase=TraversalPhase.NAVIGATING,
    )
    machine.emit(
        action=TimedRobotAction(type=RobotActionType.MOVE_FORWARD, distance_mm=500),
        duration_ms=500,
        updates={"position": Point2D(x_mm=500, y_mm=0)},
        phase=TraversalPhase.NAVIGATING,
    )

    first, second = machine.events
    assert first.phase == TraversalPhase.NAVIGATING
    assert first.timing.start_ms == 0
    assert first.timing.end_ms == second.timing.start_ms == 1000
    assert second.timing.end_ms == 1500
    assert second.state_after.elapsed_ms == 1500


def test_turn_cannot_change_position_implicitly() -> None:
    machine = TimedStateMachine(_initial())

    with pytest.raises(ValueError, match="TURN action cannot change position"):
        machine.emit(
            action=TimedRobotAction(type=RobotActionType.TURN_LEFT, turn_angle_mdeg=90000),
            duration_ms=1000,
            updates={
                "position": Point2D(x_mm=1, y_mm=0),
                "heading": Direction.WEST,
            },
            phase=TraversalPhase.NAVIGATING,
        )


def test_move_cannot_change_heading_implicitly() -> None:
    machine = TimedStateMachine(_initial())

    with pytest.raises(ValueError, match="MOVE_FORWARD cannot change heading"):
        machine.emit(
            action=TimedRobotAction(type=RobotActionType.MOVE_FORWARD, distance_mm=100),
            duration_ms=100,
            updates={
                "position": Point2D(x_mm=0, y_mm=100),
                "heading": Direction.EAST,
            },
            phase=TraversalPhase.NAVIGATING,
        )
