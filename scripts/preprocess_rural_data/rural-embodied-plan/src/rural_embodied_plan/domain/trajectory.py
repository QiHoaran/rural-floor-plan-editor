"""Trajectory event and sequence models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .geometry import Direction, Point2D
from .robot import (
    NavigationReason,
    Observation,
    RobotAction,
    RobotState,
    TimedRobotAction,
    TimedRobotState,
    TraversalPhase,
)


class MovementStep(BaseModel):
    """One compressed orthogonal path segment."""

    start: Point2D
    end: Point2D
    heading: Direction
    distance_mm: int = Field(gt=0)


class TrajectoryEvent(BaseModel):
    """One state transition containing an action, observation, or both."""

    step: int = Field(ge=0)
    phase: TraversalPhase
    state_before: RobotState
    action: RobotAction | None = None
    observation: Observation | None = None
    state_after: RobotState


class RoomActivation(BaseModel):
    """First-visit room metadata retained for reversible encoding."""

    dynamic_id: str
    source_room_id: str
    function: str
    area_mm2: int
    east_west_size_mm: int
    north_south_size_mm: int
    entry_door_id: str
    entry_direction: Direction
    depth: int
    access_mode: Literal["traversed", "visual_only"] = "traversed"


class Trajectory(BaseModel):
    """Complete deterministic exploration trajectory."""

    schema_version: str = "0.1.0"
    building_id: str
    primary_exterior_door_id: str
    room_activations: list[RoomActivation]
    events: list[TrajectoryEvent]
    visited_room_ids: list[str]
    processed_interior_door_ids: list[str]
    loop_closure_count: int = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)


class EventTiming(BaseModel):
    """Contiguous integer millisecond interval for one event."""

    start_ms: int = Field(ge=0)
    duration_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class TimedTrajectoryEvent(BaseModel):
    """One canonical event on the unified action-observation timeline."""

    step: int = Field(ge=0)
    phase: TraversalPhase
    navigation_reason: NavigationReason | None = None
    state_before: TimedRobotState
    action: TimedRobotAction | None = None
    observation: Observation | None = None
    timing: EventTiming
    state_after: TimedRobotState


class LocalEntityMap(BaseModel):
    """Audit-only mapping from model-safe local IDs to source IDs."""

    rooms: dict[str, str] = Field(default_factory=dict)
    openings: dict[str, str] = Field(default_factory=dict)


class TimedTrajectory(BaseModel):
    """Deterministic time-based canonical DFS trajectory."""

    schema_version: str = "timed-trajectory/1.0.0"
    policy_version: str = "canonical_dfs_time_v1"
    building_id: str
    robot_config_sha256: str
    primary_exterior_door_local_id: str
    events: list[TimedTrajectoryEvent]
    visited_room_local_ids: list[str]
    processed_door_local_ids: list[str]
    loop_closure_count: int = Field(ge=0)
    local_id_map: LocalEntityMap
    warnings: list[str] = Field(default_factory=list)
