"""Robot dynamics and duration discretization tests."""

import pytest

from rural_embodied_plan.config import (
    default_robot_config_path,
    load_robot_config,
    robot_config_sha256,
)
from rural_embodied_plan.timing import (
    duration_bin_token,
    movement_duration_ms,
    turn_duration_ms,
)


def test_default_robot_config_uses_expected_canonical_dynamics() -> None:
    config = load_robot_config(default_robot_config_path())

    assert config.policy_version == "canonical_dfs_time_v1"
    assert config.geometry.clearance_mm == 250
    assert config.geometry.door_anchor_offset_mm == 300
    assert config.dynamics.linear_speed_mm_per_s == 1000
    assert config.dynamics.angular_speed_mdeg_per_s == 90000
    assert config.tokenization.max_local_rooms == 256


def test_integer_time_arithmetic_is_exact_and_uses_ceiling() -> None:
    config = load_robot_config(default_robot_config_path())

    assert movement_duration_ms(2516, config.dynamics.linear_speed_mm_per_s) == 2516
    assert movement_duration_ms(1, 1500) == 1
    assert turn_duration_ms(90000, config.dynamics.angular_speed_mdeg_per_s) == 1000
    assert turn_duration_ms(180000, config.dynamics.angular_speed_mdeg_per_s) == 2000


def test_piecewise_duration_bins_keep_zero_distinct() -> None:
    config = load_robot_config(default_robot_config_path())
    boundaries = config.tokenization.duration_bin_boundaries_ms

    assert duration_bin_token(0, boundaries) == "<DT_00>"
    assert duration_bin_token(1, boundaries) == "<DT_01>"
    assert duration_bin_token(100, boundaries) == "<DT_01>"
    assert duration_bin_token(101, boundaries) == "<DT_02>"
    assert duration_bin_token(12001, boundaries) == "<DT_OVERFLOW>"


def test_robot_config_hash_is_stable() -> None:
    config = load_robot_config(default_robot_config_path())

    assert robot_config_sha256(config) == robot_config_sha256(config.model_copy(deep=True))
    assert len(robot_config_sha256(config)) == 64


def test_robot_config_rejects_ambiguous_timing_definitions() -> None:
    config = load_robot_config(default_robot_config_path()).model_dump(mode="json")
    config["tokenization"]["duration_bin_boundaries_ms"] = [0, 100, 100]

    with pytest.raises(ValueError, match="strictly increasing"):
        type(load_robot_config(default_robot_config_path())).model_validate(config)

    config = load_robot_config(default_robot_config_path()).model_dump(mode="json")
    del config["fixed_action_duration_ms"]["LOOK_LEFT"]
    with pytest.raises(ValueError, match="Missing fixed action durations"):
        type(load_robot_config(default_robot_config_path())).model_validate(config)
