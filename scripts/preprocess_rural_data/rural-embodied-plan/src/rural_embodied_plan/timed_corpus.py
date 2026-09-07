"""Quarantine-aware atomic corpus generation for canonical_dfs_time_v1."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from rural_embodied_plan.config import (
    default_config_path,
    default_robot_config_path,
    load_config,
    load_robot_config,
)
from rural_embodied_plan.io.canonical_loader import load_canonical
from rural_embodied_plan.io.json_writer import write_json
from rural_embodied_plan.pipeline import build_timed_pipeline_artifacts

BUILDING_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
SOURCE_ID_TOKEN = re.compile(r"(?:rural_|face_|we_|w_\d)")
LOCAL_REFERENCE = re.compile(r"^<(?:ROOM|DOOR|OPENING)_\d+>$")
ARTIFACT_NAMES = (
    "behavior_tokens.json",
    "building_summary.json",
    "navigation_scene.json",
    "robot_config.json",
    "timed_trajectory.json",
    "validation_report.json",
)


class TimedCorpusBuildError(RuntimeError):
    """Raised when corpus structure or final audit prevents publication."""


def _load_json(path: Path) -> Any:
    if not path.is_file():
        raise TimedCorpusBuildError(f"Required JSON file is missing: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise TimedCorpusBuildError(f"Invalid JSON at {path}: {error}") from error


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _canonical_path(root: Path, relative: object) -> Path:
    if not isinstance(relative, str) or not relative:
        raise ValueError("Manifest record has no canonical_file")
    path = (root / relative).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise ValueError(f"Canonical path escapes cleaned root: {relative}") from error
    return path


def _publish(staging: Path, output_root: Path, replace: bool) -> None:
    if output_root.exists() and not replace:
        raise TimedCorpusBuildError(
            f"Output already exists: {output_root}; pass --replace to rebuild"
        )
    if not output_root.exists():
        os.replace(staging, output_root)
        return
    backup = output_root.with_name(f".{output_root.name}.previous")
    if backup.exists():
        raise TimedCorpusBuildError(f"Atomic replacement backup already exists: {backup}")
    os.replace(output_root, backup)
    try:
        os.replace(staging, output_root)
    except Exception:
        os.replace(backup, output_root)
        raise
    shutil.rmtree(backup)


def _distribution(values: list[int]) -> dict[str, int | float | None]:
    if not values:
        return {
            "count": 0,
            "min": None,
            "p05": None,
            "p25": None,
            "median": None,
            "p75": None,
            "p95": None,
            "max": None,
            "mean": None,
            "sum": 0,
        }
    ordered = sorted(values)

    def percentile(percent: int) -> int:
        index = max(0, (percent * len(ordered) + 99) // 100 - 1)
        return ordered[index]

    return {
        "count": len(ordered),
        "min": ordered[0],
        "p05": percentile(5),
        "p25": percentile(25),
        "median": percentile(50),
        "p75": percentile(75),
        "p95": percentile(95),
        "max": ordered[-1],
        "mean": round(sum(ordered) / len(ordered), 3),
        "sum": sum(ordered),
    }


def _action_grammar_valid(tokens: list[str]) -> bool:
    for index, token in enumerate(tokens):
        if not token.startswith("<ACT_"):
            continue
        cursor = index + 1
        if cursor < len(tokens) and LOCAL_REFERENCE.fullmatch(tokens[cursor]):
            cursor += 1
        if cursor >= len(tokens) or not tokens[cursor].startswith("<DT_"):
            return False
        if cursor + 1 < len(tokens) and LOCAL_REFERENCE.fullmatch(tokens[cursor + 1]):
            return False
    return True


def _room_discovery_valid(tokens: list[str]) -> bool:
    first_occurrence: dict[str, int] = {}
    for index, token in enumerate(tokens):
        if re.fullmatch(r"<ROOM_\d+>", token):
            first_occurrence.setdefault(token, index)
    return all(
        index > 0 and tokens[index - 1] == "<OBS_ENTER_NEW_ROOM>"
        for index in first_occurrence.values()
    )


def _artifact_record(building_dir: Path, staging: Path) -> dict[str, str]:
    return {
        path.name: _sha256(path)
        for path in sorted(building_dir.iterdir(), key=lambda value: value.name)
        if path.is_file() and path.name in ARTIFACT_NAMES
    }


def _accumulate(
    scene: dict[str, Any],
    trajectory: dict[str, Any],
    behavior: dict[str, Any],
    counters: dict[str, Any],
) -> None:
    counters["rooms"] += len(scene["rooms"])
    for opening in scene["openings"]:
        counters["opening_types"][opening["opening_type"]] += 1
    counters["loop_closures"] += trajectory["loop_closure_count"]
    counters["tokens"].append(len(behavior["tokens"]))
    events = trajectory["events"]
    counters["events"].append(len(events))
    counters["trajectory_durations"].append(events[-1]["timing"]["end_ms"] if events else 0)
    for event in events:
        counters["event_durations"].append(event["timing"]["duration_ms"])
        action = event.get("action")
        if action is not None:
            action_type = action["type"]
            counters["actions"][action_type] += 1
            if action_type == "MOVE_FORWARD":
                counters["move_distances"].append(action["distance_mm"])
        observation = event.get("observation")
        if observation is not None:
            counters["observations"][observation["type"]] += 1


def _new_counters() -> dict[str, Any]:
    return {
        "rooms": 0,
        "loop_closures": 0,
        "opening_types": Counter(),
        "actions": Counter(),
        "observations": Counter(),
        "events": [],
        "tokens": [],
        "move_distances": [],
        "event_durations": [],
        "trajectory_durations": [],
    }


def _validate_manifest(manifest: Any) -> list[dict[str, Any]]:
    if not isinstance(manifest, dict) or manifest.get("schema_version") != (
        "rural-clean-manifest/1.0.0"
    ):
        raise TimedCorpusBuildError("Unsupported cleaned manifest schema")
    records = manifest.get("records")
    if not isinstance(records, list) or manifest.get("building_count") != len(records):
        raise TimedCorpusBuildError("Cleaned manifest building_count does not match records")
    seen: set[str] = set()
    validated: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            raise TimedCorpusBuildError("Cleaned manifest contains a non-object record")
        building_id = record.get("building_id")
        if not isinstance(building_id, str) or not BUILDING_ID.fullmatch(building_id):
            raise TimedCorpusBuildError(f"Unsafe building_id in cleaned manifest: {building_id!r}")
        if building_id in seen:
            raise TimedCorpusBuildError(f"Duplicate building_id in cleaned manifest: {building_id}")
        seen.add(building_id)
        validated.append(record)
    return sorted(validated, key=lambda value: str(value["building_id"]))


def build_timed_corpus(
    input_root: Path,
    output_root: Path,
    *,
    config_path: Path | None = None,
    robot_config_path: Path | None = None,
    replace: bool = False,
) -> dict[str, Any]:
    """Generate, quarantine, audit, and atomically publish a timed corpus."""

    input_root = input_root.resolve()
    output_root = output_root.resolve()
    output_root.parent.mkdir(parents=True, exist_ok=True)
    failure_path = output_root.with_name(f"{output_root.name}.failure.json")
    staging = Path(tempfile.mkdtemp(prefix=f".{output_root.name}.staging-", dir=output_root.parent))
    try:
        manifest = _load_json(input_root / "manifest.json")
        records = _validate_manifest(manifest)
        settings = load_config(config_path or default_config_path())
        robot_config = load_robot_config(robot_config_path or default_robot_config_path())
        counters = _new_counters()
        valid_records: list[dict[str, Any]] = []
        quarantined_records: list[dict[str, Any]] = []
        audit_flags = {
            "accounting_complete": True,
            "valid_artifact_sets_complete": True,
            "artifact_hashes_verified": True,
            "validation_reports_valid": True,
            "tokens_source_id_free": True,
            "action_target_duration_grammar_valid": True,
            "room_discovery_order_valid": True,
            "no_backtrack_actions": True,
            "terminal_state_valid": True,
            "no_partial_quarantine_outputs": True,
            "no_fallback_or_teleport": True,
        }
        quarantine_stages: Counter[str] = Counter()
        quarantine_types: Counter[str] = Counter()

        for manifest_index, record in enumerate(records):
            building_id = str(record["building_id"])
            building_dir = staging / building_id
            stage = "input_integrity"
            source_path: Path | None = None
            actual_sha: str | None = None
            try:
                source_path = _canonical_path(input_root, record.get("canonical_file"))
                actual_sha = _sha256(source_path)
                if actual_sha != record.get("canonical_sha256"):
                    raise ValueError(
                        f"Canonical SHA-256 mismatch: expected {record.get('canonical_sha256')}, "
                        f"got {actual_sha}"
                    )
                stage = "canonical_load"
                document = load_canonical(source_path)
                if document.building_id != building_id:
                    raise ValueError(f"Canonical building_id mismatch: {document.building_id}")
                stage = "timed_pipeline"
                build_timed_pipeline_artifacts(document, building_dir, settings, robot_config)
                generated_names = tuple(
                    sorted(path.name for path in building_dir.iterdir() if path.is_file())
                )
                audit_flags["valid_artifact_sets_complete"] &= generated_names == ARTIFACT_NAMES
                report = _load_json(building_dir / "validation_report.json")
                scene = _load_json(building_dir / "navigation_scene.json")
                trajectory = _load_json(building_dir / "timed_trajectory.json")
                behavior = _load_json(building_dir / "behavior_tokens.json")
                tokens = behavior["tokens"]
                audit_flags["validation_reports_valid"] &= report.get("status") == "valid"
                audit_flags["tokens_source_id_free"] &= not any(
                    SOURCE_ID_TOKEN.search(token) for token in tokens
                )
                audit_flags["action_target_duration_grammar_valid"] &= _action_grammar_valid(tokens)
                audit_flags["room_discovery_order_valid"] &= _room_discovery_valid(tokens)
                actions = [
                    event["action"]
                    for event in trajectory["events"]
                    if event.get("action") is not None
                ]
                audit_flags["no_backtrack_actions"] &= not any(
                    action["type"] == "BACKTRACK" for action in actions
                )
                final_event = trajectory["events"][-1]
                audit_flags["terminal_state_valid"] &= (
                    final_event["action"]["type"] == "STOP"
                    and final_event["phase"] == "COMPLETE"
                    and final_event["state_after"]["current_room_local_id"] is None
                )
                audit_flags["no_fallback_or_teleport"] &= (
                    trajectory.get("warnings") == []
                    and sum(action["type"] == "SELECT_EXTERIOR_DOOR" for action in actions) == 1
                )
                artifacts = _artifact_record(building_dir, staging)
                audit_flags["artifact_hashes_verified"] &= all(
                    _sha256(building_dir / name) == digest for name, digest in artifacts.items()
                )
                _accumulate(scene, trajectory, behavior, counters)
                valid_records.append(
                    {
                        "building_id": building_id,
                        "source_canonical_file": record.get("canonical_file"),
                        "source_canonical_sha256": actual_sha,
                        "artifact_directory": building_id,
                        "artifact_sha256": artifacts,
                    }
                )
            except Exception as error:
                if building_dir.exists():
                    shutil.rmtree(building_dir)
                quarantine_stages[stage] += 1
                quarantine_types[type(error).__name__] += 1
                relative_report = Path("quarantine") / building_id / "quarantine_report.json"
                quarantine = {
                    "schema_version": "timed-corpus-quarantine/1.0.0",
                    "policy_version": robot_config.policy_version,
                    "building_id": building_id,
                    "manifest_index": manifest_index,
                    "source_canonical_file": record.get("canonical_file"),
                    "expected_canonical_sha256": record.get("canonical_sha256"),
                    "actual_canonical_sha256": actual_sha,
                    "stage": stage,
                    "error_type": type(error).__name__,
                    "message": str(error),
                }
                write_json(staging / relative_report, quarantine)
                quarantined_records.append(
                    {
                        "building_id": building_id,
                        "quarantine_report": relative_report.as_posix(),
                        "stage": stage,
                        "error_type": type(error).__name__,
                    }
                )

        audit_flags["accounting_complete"] = len(valid_records) + len(quarantined_records) == len(
            records
        )
        audit_flags["no_partial_quarantine_outputs"] = all(
            not (staging / record["building_id"]).exists() for record in quarantined_records
        )
        corpus_manifest = {
            "schema_version": "canonical-dfs-time-corpus-manifest/1.0.0",
            "policy_version": robot_config.policy_version,
            "source_corpus_hash": manifest.get("corpus_hash"),
            "input_building_count": len(records),
            "valid_buildings": valid_records,
            "quarantined_buildings": sorted(
                quarantined_records, key=lambda value: value["building_id"]
            ),
        }
        summary = {
            "schema_version": "canonical-dfs-time-corpus/1.0.0",
            "policy_version": robot_config.policy_version,
            "source_corpus_hash": manifest.get("corpus_hash"),
            "input_building_count": len(records),
            "valid_building_count": len(valid_records),
            "quarantined_building_count": len(quarantined_records),
            "artifact_count": len(valid_records) * len(ARTIFACT_NAMES),
            "schema_validation_count": len(valid_records) * 3,
            "entity_statistics": {
                "room_count": counters["rooms"],
                "opening_type_counts": dict(sorted(counters["opening_types"].items())),
                "loop_closure_count": counters["loop_closures"],
            },
            "behavior_statistics": {
                "action_type_counts": dict(sorted(counters["actions"].items())),
                "observation_type_counts": dict(sorted(counters["observations"].items())),
                "events_per_building": _distribution(counters["events"]),
                "tokens_per_building": _distribution(counters["tokens"]),
                "move_distance_mm": _distribution(counters["move_distances"]),
                "event_duration_ms": _distribution(counters["event_durations"]),
                "trajectory_duration_ms": _distribution(counters["trajectory_durations"]),
            },
            "quarantine_statistics": {
                "stage_counts": dict(sorted(quarantine_stages.items())),
                "error_type_counts": dict(sorted(quarantine_types.items())),
            },
        }
        audit = {
            "schema_version": "canonical-dfs-time-dataset-audit/1.0.0",
            "policy_version": robot_config.policy_version,
            "status": "valid" if all(audit_flags.values()) else "invalid",
            "checks": audit_flags,
            "training_started": False,
        }
        write_json(staging / "corpus_manifest.json", corpus_manifest)
        write_json(staging / "corpus_summary.json", summary)
        write_json(staging / "dataset_audit.json", audit)
        if audit["status"] != "valid":
            failed = [name for name, passed in audit_flags.items() if not passed]
            raise TimedCorpusBuildError(f"Dataset audit failed: {failed}")
        _publish(staging, output_root, replace)
        if failure_path.exists():
            failure_path.unlink()
        return summary
    except Exception as error:
        if staging.exists():
            shutil.rmtree(staging)
        write_json(
            failure_path,
            {
                "status": "failed",
                "error_type": type(error).__name__,
                "message": str(error),
            },
        )
        if isinstance(error, TimedCorpusBuildError):
            raise
        raise TimedCorpusBuildError(str(error)) from error
