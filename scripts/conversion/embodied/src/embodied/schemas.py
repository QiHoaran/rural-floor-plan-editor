"""Strict JSON artifact schemas; generated schemas contain no empty payload objects."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Rational(StrictModel):
    num: int
    den: int = Field(gt=0)


class State(StrictModel):
    position_mm: tuple[Rational, Rational]
    heading: int = Field(ge=0, le=3)
    room_local_id: int | None = Field(ge=0)


class Observation(StrictModel):
    type: Literal[
        "EXTERIOR_DOOR",
        "ENTER_NEW_ROOM",
        "ENTER_VISITED_ROOM",
        "ENTRY_WALL",
        "WALL",
        "LOOP_CLOSURE",
    ]
    tokens: list[str]


class Event(StrictModel):
    session: int = Field(ge=0)
    step: int = Field(ge=0)
    action: (
        Literal[
            "MOVE_FORWARD",
            "TURN_LEFT",
            "TURN_RIGHT",
            "TURN_BACK",
            "CROSS_DOOR",
            "EXIT_BUILDING",
            "LOOK_FRONT",
            "LOOK_LEFT",
            "LOOK_RIGHT",
            "SELECT_INTERIOR_DOOR",
            "STOP",
        ]
        | None
    )
    target: int | None = Field(ge=0)
    observation: Observation | None = None
    start_ms: Rational
    duration_ms: Rational
    end_ms: Rational
    state_before: State
    state_after: State


class Session(StrictModel):
    session_index: int = Field(ge=0)
    kind: Literal["global_scan", "indoor_episode"]
    initial_state: State
    events: list[Event] = Field(min_length=1)
    duration_ms: Rational


class TimedTrajectory(StrictModel):
    schema_version: Literal["timed-trajectory/2"]
    sessions: list[Session] = Field(min_length=2)
    session_transition: Literal["reset; no physical transfer or elapsed transfer time"]


class BehaviorTokens(StrictModel):
    schema_version: Literal["behavior-tokens/2"]
    policy_version: Literal["canonical_global_scan_dfs_time_v2"]
    vocabulary_version: Literal["behavior-floorplan-exact-v2"]
    robot_config_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    tokens: list[str] = Field(min_length=1)
    token_ids: list[int] = Field(min_length=1)
