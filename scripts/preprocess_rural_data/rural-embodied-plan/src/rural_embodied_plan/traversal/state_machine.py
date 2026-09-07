"""Trajectory event recorder with explicit before/after state snapshots."""

from collections.abc import Mapping
from typing import Any

from rural_embodied_plan.domain.robot import (
    NavigationReason,
    Observation,
    RobotAction,
    RobotActionType,
    RobotState,
    TimedRobotAction,
    TimedRobotState,
    TraversalPhase,
)
from rural_embodied_plan.domain.trajectory import EventTiming, TimedTrajectoryEvent, TrajectoryEvent


class StateMachine:
    """Maintain robot state and append deterministic transition events."""

    def __init__(self, initial_state: RobotState) -> None:
        self.state = initial_state
        self.events: list[TrajectoryEvent] = []

    def emit(
        self,
        *,
        action: RobotAction | None = None,
        observation: Observation | None = None,
        updates: Mapping[str, Any] | None = None,
        phase: TraversalPhase | None = None,
    ) -> None:
        """Apply updates and record one fully structured transition."""

        if action is None and observation is None:
            raise ValueError("A trajectory event requires an action or observation")
        before = self.state.model_copy(deep=True)
        values = dict(updates or {})
        values["trajectory_step"] = before.trajectory_step + 1
        if phase is not None:
            values["phase"] = phase
        self.state = before.model_copy(update=values, deep=True)
        self.events.append(
            TrajectoryEvent(
                step=len(self.events),
                phase=before.phase,
                state_before=before,
                action=action,
                observation=observation,
                state_after=self.state.model_copy(deep=True),
            )
        )


class TimedStateMachine:
    """Record validated contiguous transitions on an integer timeline."""

    def __init__(self, initial_state: TimedRobotState) -> None:
        self.state = initial_state
        self.events: list[TimedTrajectoryEvent] = []

    def emit(
        self,
        *,
        duration_ms: int,
        action: TimedRobotAction | None = None,
        observation: Observation | None = None,
        updates: Mapping[str, Any] | None = None,
        phase: TraversalPhase | None = None,
        navigation_reason: NavigationReason | None = None,
    ) -> None:
        """Apply one physically checked state transition and advance time."""

        if action is None and observation is None:
            raise ValueError("A timed event requires an action or observation")
        if duration_ms < 0:
            raise ValueError("Event duration cannot be negative")
        before = self.state.model_copy(deep=True)
        values = dict(updates or {})
        executing_phase = phase or before.phase
        next_position = values.get("position", before.position)
        next_heading = values.get("heading", before.heading)
        if (
            action is not None
            and action.type
            in {
                RobotActionType.TURN_LEFT,
                RobotActionType.TURN_RIGHT,
                RobotActionType.TURN_BACK,
            }
            and next_position != before.position
        ):
            raise ValueError("TURN action cannot change position")
        if (
            action is not None
            and action.type == RobotActionType.MOVE_FORWARD
            and next_heading != before.heading
        ):
            raise ValueError("MOVE_FORWARD cannot change heading")
        end_ms = before.elapsed_ms + duration_ms
        values.update(
            {
                "trajectory_step": before.trajectory_step + 1,
                "elapsed_ms": end_ms,
                "phase": executing_phase,
            }
        )
        self.state = before.model_copy(update=values, deep=True)
        self.events.append(
            TimedTrajectoryEvent(
                step=len(self.events),
                phase=executing_phase,
                navigation_reason=navigation_reason,
                state_before=before,
                action=action,
                observation=observation,
                timing=EventTiming(
                    start_ms=before.elapsed_ms,
                    duration_ms=duration_ms,
                    end_ms=end_ms,
                ),
                state_after=self.state.model_copy(deep=True),
            )
        )
