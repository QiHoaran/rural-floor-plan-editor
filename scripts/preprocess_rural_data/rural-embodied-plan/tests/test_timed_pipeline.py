"""Single-building canonical timed pipeline tests."""

import json
from pathlib import Path
from editor_samples import sample_path

from rural_embodied_plan.config import (
    default_robot_config_path,
    load_config,
    load_robot_config,
)
from rural_embodied_plan.io.building_loader import load_building
from rural_embodied_plan.pipeline import build_timed_pipeline_artifacts


def test_timed_pipeline_writes_validated_artifacts(tmp_path: Path) -> None:
    raw = sample_path("rural_001_house_0001")
    package = Path(__file__).resolve().parents[1]

    report = build_timed_pipeline_artifacts(
        load_building(raw),
        tmp_path,
        load_config(package / "examples/sample_config.yaml"),
        load_robot_config(default_robot_config_path()),
    )

    assert report["status"] == "valid"
    assert report["timed_trajectory_errors"] == []
    assert report["schema_validation_count"] == 3
    assert {path.name for path in tmp_path.iterdir()} == {
        "building_summary.json",
        "navigation_scene.json",
        "robot_config.json",
        "timed_trajectory.json",
        "behavior_tokens.json",
        "validation_report.json",
    }
    behavior = json.loads((tmp_path / "behavior_tokens.json").read_text(encoding="utf-8"))
    assert behavior["policy_version"] == "canonical_dfs_time_v1"
    assert behavior["tokens"][0] == "<BOS>"
    assert behavior["tokens"][-1] == "<EOS>"


def test_timed_pipeline_is_byte_deterministic(tmp_path: Path) -> None:
    package = Path(__file__).resolve().parents[1]
    raw = sample_path("rural_001_house_0001")
    document = load_building(raw)
    settings = load_config(package / "examples/sample_config.yaml")
    robot = load_robot_config(default_robot_config_path())
    first = tmp_path / "first"
    second = tmp_path / "second"

    build_timed_pipeline_artifacts(document, first, settings, robot)
    build_timed_pipeline_artifacts(document, second, settings, robot)

    for name in ("timed_trajectory.json", "behavior_tokens.json"):
        assert (first / name).read_bytes() == (second / name).read_bytes()
