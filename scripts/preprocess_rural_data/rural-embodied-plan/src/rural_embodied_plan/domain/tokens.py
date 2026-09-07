"""Token sequence and reconstructed graph models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TokenSequence(BaseModel):
    """Readable tokens plus deterministic integer IDs."""

    vocabulary_version: str = "0.1.0"
    tokens: list[str]
    token_ids: list[int]
    source_trajectory: str = "trajectory.json"


class BehaviorTokenSequence(BaseModel):
    """Fixed-vocabulary behavior-time view of one timed trajectory."""

    schema_version: str = "behavior-tokens/1.0.0"
    policy_version: str = "canonical_dfs_time_v1"
    vocabulary_version: str = "behavior-time-v1"
    task_mode: Literal["pure_action", "action_perception"]
    source_trajectory_sha256: str
    sample_id: str
    tokens: list[str]
    token_ids: list[int]


class SpatialGraphRoom(BaseModel):
    """Room node recovered solely from tokens."""

    dynamic_id: str
    function: str
    depth: int
    area_bin: str


class SpatialGraphEdge(BaseModel):
    """Door edge recovered solely from tokens."""

    door_id: str
    room_a: str
    room_b: str | None
    exterior: bool
    directions: list[str] = Field(default_factory=list)


class SpatialGraph(BaseModel):
    """Token-reconstructed room graph and principal spatial attributes."""

    vocabulary_version: str
    rooms: list[SpatialGraphRoom]
    edges: list[SpatialGraphEdge]
    primary_exterior_door_id: str
    entrance_room_id: str
    loop_count: int = Field(ge=0)
    opening_directions: dict[str, list[str]] = Field(default_factory=dict)
