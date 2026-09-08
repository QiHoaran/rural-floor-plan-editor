"""Versioned exact dynamics. No environment geometry or source identifiers."""

import hashlib
from fractions import Fraction
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Config(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal["robot-config/2"] = "robot-config/2"
    policy_version: Literal["canonical_global_scan_dfs_time_v2"] = (
        "canonical_global_scan_dfs_time_v2"
    )
    vocabulary_version: Literal["behavior-floorplan-exact-v2"] = "behavior-floorplan-exact-v2"
    exterior_scan_offset_mm: int = Field(default=1000, gt=0)
    linear_speed_mm_s: int = Field(default=1000, gt=0)
    angular_speed_mdeg_s: int = Field(default=90000, gt=0)
    crossing_speed_mm_s: int = Field(default=1000, gt=0)
    robot_radius_mm: int = Field(default=175, gt=0)
    safety_margin_mm: int = Field(default=75, ge=0)
    anchor_offset_mm: int = Field(default=300, gt=0)
    look_ms: int = Field(default=300, ge=0)
    select_ms: int = Field(default=200, ge=0)
    # The input polygon defines the nominal navigation boundary, as in v1.
    polygon_semantics: Literal["nominal_navigation_boundary"] = "nominal_navigation_boundary"
    duration_bins_ms: tuple[int, ...] = (
        0,
        100,
        200,
        300,
        400,
        500,
        750,
        1000,
        1250,
        1500,
        1750,
        2000,
        2250,
        2500,
        2750,
        3000,
        3500,
        4000,
        4500,
        5000,
        6000,
        7000,
        8000,
        10000,
        12000,
    )

    @model_validator(mode="after")
    def valid_geometry(self) -> "Config":
        if self.anchor_offset_mm < self.clearance_mm:
            raise ValueError("DOOR_CLEARANCE_INVALID: anchor is inside clearance band")
        if self.exterior_scan_offset_mm < self.clearance_mm:
            raise ValueError("PATH_INVALID: scan offset below clearance")
        if not self.duration_bins_ms or self.duration_bins_ms[0] != 0:
            raise ValueError("duration bins must begin at zero")
        if tuple(sorted(set(self.duration_bins_ms))) != self.duration_bins_ms:
            raise ValueError("duration bins must strictly increase")
        return self

    @property
    def clearance_mm(self) -> int:
        return self.robot_radius_mm + self.safety_margin_mm

    def move_time(self, distance: Fraction, *, crossing: bool = False) -> Fraction:
        if distance < 0:
            raise ValueError("PATH_INVALID: negative movement")
        return distance * 1000 / (self.crossing_speed_mm_s if crossing else self.linear_speed_mm_s)

    def turn_time(self, quarter_turns: int) -> Fraction:
        return Fraction(quarter_turns * 90000 * 1000, self.angular_speed_mdeg_s)

    def digest(self) -> str:
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()
