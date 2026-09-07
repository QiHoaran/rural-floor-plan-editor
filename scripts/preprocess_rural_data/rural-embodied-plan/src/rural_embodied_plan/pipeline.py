"""Reusable deterministic six-artifact pipeline for one building."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from rural_embodied_plan.analysis.building_statistics import building_summary
from rural_embodied_plan.analysis.trajectory_statistics import (
    trajectory_statistics,
    validate_timed_trajectory,
    validate_trajectory,
)
from rural_embodied_plan.config import ProjectConfig, RobotConfig
from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.encoding.behavior_encoder import encode_behavior_tokens
from rural_embodied_plan.encoding.trajectory_encoder import encode_trajectory
from rural_embodied_plan.io.json_writer import write_json
from rural_embodied_plan.io.schema_validator import validate_with_schema
from rural_embodied_plan.reconstruction.graph_builder import reconstruct_spatial_graph
from rural_embodied_plan.reconstruction.graph_validator import validate_roundtrip
from rural_embodied_plan.scene.scene_builder import build_scene
from rural_embodied_plan.scene.scene_validator import validate_scene
from rural_embodied_plan.traversal.explorer import generate_timed_trajectory, generate_trajectory


def build_pipeline_artifacts(
    document: BuildingDocument,
    output_dir: Path,
    settings: ProjectConfig,
) -> dict[str, Any]:
    """Build, validate, and write the six established artifacts for one building."""

    scene = build_scene(document, settings)
    trajectory = generate_trajectory(scene)
    tokens = encode_trajectory(trajectory, settings)
    graph = reconstruct_spatial_graph(tokens)
    scene_errors = validate_scene(scene)
    trajectory_errors = validate_trajectory(scene, trajectory)
    roundtrip_errors = validate_roundtrip(trajectory, graph)
    all_errors = scene_errors + trajectory_errors + roundtrip_errors
    if all_errors:
        raise ValueError("; ".join(all_errors))

    schema_root = Path(__file__).resolve().parents[2] / "schemas"
    schema_models = (
        (scene, "navigation_scene.schema.json"),
        (trajectory, "trajectory.schema.json"),
        (tokens, "token_sequence.schema.json"),
    )
    for model, filename in schema_models:
        validate_with_schema(model.model_dump(mode="json"), schema_root / filename)

    report = {
        "status": "valid",
        "scene_errors": [],
        "trajectory_errors": [],
        "roundtrip_errors": [],
        "scene_warnings": scene.warnings,
        "trajectory_warnings": trajectory.warnings,
        "trajectory_statistics": trajectory_statistics(trajectory),
        "token_count": len(tokens.tokens),
        "reconstructed_room_count": len(graph.rooms),
        "reconstructed_edge_count": len(graph.edges),
        "schema_validation_count": 3,
    }
    write_json(output_dir / "building_summary.json", building_summary(document, scene))
    write_json(output_dir / "navigation_scene.json", scene)
    write_json(output_dir / "trajectory.json", trajectory)
    write_json(output_dir / "tokens.json", tokens)
    write_json(output_dir / "reconstructed_spatial_graph.json", graph)
    write_json(output_dir / "validation_report.json", report)
    return report


def build_timed_pipeline_artifacts(
    document: BuildingDocument,
    output_dir: Path,
    settings: ProjectConfig,
    robot_config: RobotConfig,
) -> dict[str, Any]:
    """Build and validate the canonical timed artifacts for one building only."""

    scene = build_scene(document, settings)
    scene_errors = validate_scene(scene)
    if scene_errors:
        raise ValueError("; ".join(scene_errors))
    trajectory = generate_timed_trajectory(scene, robot_config)
    trajectory_errors = validate_timed_trajectory(scene, trajectory, robot_config)
    if trajectory_errors:
        raise ValueError("; ".join(trajectory_errors))
    behavior = encode_behavior_tokens(trajectory, robot_config, task_mode="action_perception")

    schema_root = Path(__file__).resolve().parents[2] / "schemas"
    schema_models = (
        (robot_config, "robot_config.schema.json"),
        (trajectory, "timed_trajectory.schema.json"),
        (behavior, "behavior_tokens.schema.json"),
    )
    for model, filename in schema_models:
        validate_with_schema(model.model_dump(mode="json"), schema_root / filename)

    report = {
        "status": "valid",
        "policy_version": trajectory.policy_version,
        "scene_errors": [],
        "timed_trajectory_errors": [],
        "scene_warnings": scene.warnings,
        "trajectory_warnings": trajectory.warnings,
        "event_count": len(trajectory.events),
        "token_count": len(behavior.tokens),
        "total_duration_ms": (trajectory.events[-1].timing.end_ms if trajectory.events else 0),
        "schema_validation_count": len(schema_models),
    }
    write_json(output_dir / "building_summary.json", building_summary(document, scene))
    write_json(output_dir / "navigation_scene.json", scene)
    write_json(output_dir / "robot_config.json", robot_config)
    write_json(output_dir / "timed_trajectory.json", trajectory)
    write_json(output_dir / "behavior_tokens.json", behavior)
    write_json(output_dir / "validation_report.json", report)
    return report
