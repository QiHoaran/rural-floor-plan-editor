"""Configuration loading for geometry discretization and traversal."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator


class BinConfig(BaseModel):
    """Monotonically increasing upper bounds for one token family."""

    boundaries: list[int] = Field(min_length=1)


class DiscretizationConfig(BaseModel):
    """All configurable numeric token bins."""

    length_mm: BinConfig
    width_mm: BinConfig
    area_mm2: BinConfig
    position_per_mille: BinConfig
    distance_mm: BinConfig


class ProjectConfig(BaseModel):
    """Validated project configuration."""

    discretization: DiscretizationConfig
    max_dynamic_rooms: int = Field(default=256, ge=1)
    max_dynamic_doors: int = Field(default=512, ge=1)
    anchor_offset_mm: int = Field(default=200, ge=1)
    path_grid_mm: int = Field(default=100, ge=1)


class RobotGeometryConfig(BaseModel):
    """Physical footprint and canonical doorway-anchor geometry."""

    radius_mm: int = Field(gt=0)
    safety_margin_mm: int = Field(ge=0)
    door_anchor_offset_mm: int = Field(gt=0)

    @property
    def clearance_mm(self) -> int:
        return self.radius_mm + self.safety_margin_mm


class RobotDynamicsConfig(BaseModel):
    """Integer robot speeds used for exact ceiling time arithmetic."""

    linear_speed_mm_per_s: int = Field(gt=0)
    angular_speed_mdeg_per_s: int = Field(gt=0)
    door_crossing_speed_mm_per_s: int = Field(gt=0)


class RobotPlannerConfig(BaseModel):
    """Versioned planner semantics."""

    motion_model: Literal["rectilinear"] = "rectilinear"
    objective: Literal["minimum_execution_time"] = "minimum_execution_time"
    loop_shortcuts: Literal[False] = False


class RobotTokenizationConfig(BaseModel):
    """Duration vocabulary thresholds in milliseconds."""

    duration_bin_boundaries_ms: list[int] = Field(min_length=2)
    length_bin_boundaries_mm: list[int] = Field(min_length=1)
    width_bin_boundaries_mm: list[int] = Field(min_length=1)
    position_bin_boundaries_per_mille: list[int] = Field(min_length=1)
    max_local_rooms: int = Field(gt=0)
    max_local_doors: int = Field(gt=0)
    max_local_openings: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_boundaries(self) -> RobotTokenizationConfig:
        """Require unambiguous inclusive upper-bound bins."""

        families = {
            "duration": self.duration_bin_boundaries_ms,
            "length": self.length_bin_boundaries_mm,
            "width": self.width_bin_boundaries_mm,
            "position": self.position_bin_boundaries_per_mille,
        }
        for name, boundaries in families.items():
            if boundaries != sorted(set(boundaries)):
                raise ValueError(f"{name} boundaries must be strictly increasing")
        if self.duration_bin_boundaries_ms[0] != 0:
            raise ValueError("duration boundaries must begin with zero")
        return self


class RobotConfig(BaseModel):
    """Independent robot, policy, and behavior-token configuration."""

    schema_version: Literal["robot-config/1.0.0"]
    policy_version: Literal["canonical_dfs_time_v1"]
    robot_model: str
    geometry: RobotGeometryConfig
    dynamics: RobotDynamicsConfig
    fixed_action_duration_ms: dict[str, int]
    planner: RobotPlannerConfig
    tokenization: RobotTokenizationConfig

    @model_validator(mode="after")
    def validate_fixed_durations(self) -> RobotConfig:
        """Require every fixed-duration action used by this policy."""

        required = {
            "SELECT_EXTERIOR_DOOR",
            "SELECT_INTERIOR_DOOR",
            "LOOK_FRONT",
            "LOOK_LEFT",
            "LOOK_RIGHT",
            "STOP",
        }
        missing = sorted(required - self.fixed_action_duration_ms.keys())
        if missing:
            raise ValueError(f"Missing fixed action durations: {missing}")
        if any(value < 0 for value in self.fixed_action_duration_ms.values()):
            raise ValueError("Fixed action durations must be non-negative")
        return self


def load_robot_config(path: Path) -> RobotConfig:
    """Load a versioned robot JSON configuration."""

    if not path.is_file():
        raise FileNotFoundError(f"Robot configuration file does not exist: {path}")
    raw: Any = json.loads(path.read_text(encoding="utf-8"))
    return RobotConfig.model_validate(raw)


def robot_config_sha256(config: RobotConfig) -> str:
    """Return the canonical content hash used to bind generated artifacts."""

    encoded = json.dumps(
        config.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_config(path: Path) -> ProjectConfig:
    """Load and validate a YAML configuration file."""

    if not path.is_file():
        raise FileNotFoundError(f"Configuration file does not exist: {path}")
    raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    return ProjectConfig.model_validate(raw)


def default_config_path() -> Path:
    """Return the repository default configuration path."""

    return Path(__file__).parents[2] / "examples" / "sample_config.yaml"


def default_robot_config_path() -> Path:
    """Return the repository default robot configuration path."""

    return Path(__file__).parents[2] / "examples" / "robot_config.json"
