"""Robot actions, observations, phases, and mutable state snapshots."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from .geometry import Direction, Point2D, RelativeDirection


class RobotActionType(StrEnum):
    """Closed action vocabulary for room-level exploration."""

    MOVE_FORWARD = "MOVE_FORWARD"
    TURN_LEFT = "TURN_LEFT"
    TURN_RIGHT = "TURN_RIGHT"
    TURN_BACK = "TURN_BACK"
    CROSS_DOOR = "CROSS_DOOR"
    LOOK_FRONT = "LOOK_FRONT"
    LOOK_LEFT = "LOOK_LEFT"
    LOOK_RIGHT = "LOOK_RIGHT"
    SELECT_EXTERIOR_DOOR = "SELECT_EXTERIOR_DOOR"
    SELECT_EXTERIOR_WINDOW = "SELECT_EXTERIOR_WINDOW"
    SELECT_INTERIOR_DOOR = "SELECT_INTERIOR_DOOR"
    BACKTRACK = "BACKTRACK"
    EXIT_BUILDING = "EXIT_BUILDING"
    STOP = "STOP"


class ObservationType(StrEnum):
    """Structured observation categories."""

    OUTSIDE = "OUTSIDE"
    AT_DOOR = "AT_DOOR"
    EXTERIOR_WINDOW_VIEW = "EXTERIOR_WINDOW_VIEW"
    ENTER_NEW_ROOM = "ENTER_NEW_ROOM"
    ENTER_VISITED_ROOM = "ENTER_VISITED_ROOM"
    ENTRY_WALL = "ENTRY_WALL"
    WALL = "WALL"
    DOOR = "DOOR"
    WINDOW = "WINDOW"
    OPEN_PASSAGE = "OPEN_PASSAGE"
    SECONDARY_EXTERIOR_DOOR = "SECONDARY_EXTERIOR_DOOR"
    LOOP_CLOSURE = "LOOP_CLOSURE"
    DEAD_END = "DEAD_END"


class TraversalPhase(StrEnum):
    """Robot state-machine phases."""

    OUTSIDE = "OUTSIDE"
    ENTERING = "ENTERING"
    OBSERVING = "OBSERVING"
    NAVIGATING = "NAVIGATING"
    BACKTRACKING = "BACKTRACKING"
    CROSSING = "CROSSING"
    LOOP_CLOSING = "LOOP_CLOSING"
    RETURNING = "RETURNING"
    EXITING = "EXITING"
    COMPLETE = "COMPLETE"


class NavigationReason(StrEnum):
    """Why a physical navigation action is being executed."""

    TO_FRONTIER = "TO_FRONTIER"
    RETURN_TO_PARENT = "RETURN_TO_PARENT"
    RETURN_TO_PRIMARY_EXIT = "RETURN_TO_PRIMARY_EXIT"
    LOOP_RETURN = "LOOP_RETURN"


class RobotState(BaseModel):
    """Serializable snapshot of all required robot state."""

    position: Point2D
    heading: Direction
    phase: TraversalPhase
    current_room_id: str | None = None
    current_door_id: str | None = None
    entry_door_id: str | None = None
    primary_exterior_door_id: str
    visited_room_ids: list[str] = Field(default_factory=list)
    visited_door_ids: list[str] = Field(default_factory=list)
    processed_opening_ids: list[str] = Field(default_factory=list)
    room_stack: list[str] = Field(default_factory=list)
    trajectory_step: int = Field(ge=0, default=0)


class RobotAction(BaseModel):
    """One structured robot action."""

    type: RobotActionType
    distance_mm: int | None = None
    door_id: str | None = None
    target_room_id: str | None = None


class TimedRobotState(BaseModel):
    """ID-safe robot state used by canonical timed trajectories."""

    position: Point2D
    heading: Direction
    phase: TraversalPhase
    current_room_local_id: str | None = None
    current_door_local_id: str | None = None
    entry_door_local_id: str | None = None
    dfs_depth: int = Field(default=0, ge=0)
    trajectory_step: int = Field(default=0, ge=0)
    elapsed_ms: int = Field(default=0, ge=0)


class TimedRobotAction(BaseModel):
    """Physical or selection action using only trajectory-local references."""

    type: RobotActionType
    distance_mm: int | None = Field(default=None, ge=0)
    turn_angle_mdeg: int | None = Field(default=None, ge=0)
    door_local_id: str | None = None
    target_room_local_id: str | None = None


class ObservedOpening(BaseModel):
    """Opening details recorded during wall observation."""

    id: str
    type: str
    center: Point2D
    width_mm: int
    normalized_position: float


class ObservedWallSegment(BaseModel):
    """Observed wall segment and its sorted components."""

    id: str
    length_mm: int
    openings: list[ObservedOpening]


class Observation(BaseModel):
    """Structured environment observation."""

    type: ObservationType
    relative_direction: RelativeDirection | None = None
    global_direction: Direction | None = None
    wall_segments: list[ObservedWallSegment] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
