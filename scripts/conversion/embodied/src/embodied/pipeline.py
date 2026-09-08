"""Single-building exact publication. Existing outputs are never overwritten."""

import json
import tempfile
from fractions import Fraction
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from embodied.building import BuildingDocument
from embodied.config import Config
from embodied.floorplan import CanonicalFloorplan, canonicalize_floorplan
from embodied.floorplan_encoder import Encoder, encode_floorplan
from embodied.planner import shift
from embodied.roundtrip_validator import validate_roundtrip
from embodied.schemas import BehaviorTokens, TimedTrajectory
from embodied.vocabulary import vocabulary


def json_value(value: Any) -> Any:
    if isinstance(value, Fraction):
        return {"num": value.numerator, "den": value.denominator}
    if isinstance(value, dict):
        return {k: json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(v) for v in value]
    return value


def build_artifacts(
    document: BuildingDocument | dict[str, Any], output: Path, config: Config
) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    source_id = document.get("building_id") if isinstance(document, dict) else document.building_id
    try:
        if isinstance(document, dict):
            for room in document.get("faces", {}).values():
                if any(room.get(key) for key in ("holes", "interior_rings", "obstacles")):
                    raise ValueError(
                        "UNSUPPORTED_GEOMETRY: room holes/obstacles require a future codec"
                    )
            document = BuildingDocument.model_validate(document)
        floorplan = canonicalize_floorplan(document)
        tokens = encode_floorplan(floorplan, config)
        reconstructed, events, report = validate_roundtrip(floorplan, tokens, config)
    except ValueError as exc:
        # Only explicit data/codec reason codes may be quarantined. Programming
        # exceptions and unclassified ValueErrors propagate and prevent publication.
        prefixes = (
            "UNREACHABLE_COMPONENT",
            "UNOBSERVABLE_GEOMETRY",
            "UNSUPPORTED_GEOMETRY",
            "UNOBSERVED_OPENING",
            "INCONSISTENT_INCIDENCE",
            "INCONSISTENT_CHANNELS",
            "AMBIGUOUS_GEOMETRY",
            "AMBIGUOUS_CANONICAL_ENTITY",
            "DOOR_CLEARANCE_INVALID",
            "PATH_INVALID",
            "GEOMETRY_CONFLICT",
            "TOKEN_GRAMMAR_ERROR",
            "FLOORPLAN_ROUNDTRIP_MISMATCH",
            "NON_DETERMINISTIC_REENCODE",
        )
        if not str(exc).startswith(prefixes):
            raise
        report = {
            "status": "quarantined",
            "roundtrip_exact": False,
            "reason": str(exc),
            "reason_code": str(exc).split(":", 1)[0],
            "source_building_id": source_id,
        }
        output.mkdir(parents=True, exist_ok=False)
        (output / "quarantine_report.json").write_text(
            json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        return report
    vocab = vocabulary(config)
    lookup = {token: index for index, token in enumerate(vocab)}
    if not set(tokens) <= lookup.keys():
        raise ValueError("TOKEN_GRAMMAR_ERROR: token outside fixed vocabulary")
    sessions = []
    for number in sorted({e["session"] for e in events}):
        session_events = [
            dict(e, step=i) for i, e in enumerate(e for e in events if e["session"] == number)
        ]
        sessions.append(
            {
                "session_index": number,
                "kind": "global_scan" if number == 0 else "indoor_episode",
                "initial_state": session_events[0]["state_before"],
                "events": session_events,
                "duration_ms": session_events[-1]["end_ms"],
            }
        )
    report["total_execution_ms"] = sum((s["duration_ms"] for s in sessions), Fraction(0))
    report["action_count"] = sum(e["action"] is not None for e in events)
    report["observation_count"] = sum(e.get("observation") is not None for e in events)
    artifacts: dict[str, Any] = {
        "canonical_floorplan.json": floorplan.model_dump(mode="json"),
        "reconstructed_floorplan.json": reconstructed.model_dump(mode="json"),
        "robot_config.json": config.model_dump(mode="json"),
        "behavior_tokens.json": {
            "schema_version": "behavior-tokens/2",
            "policy_version": config.policy_version,
            "vocabulary_version": config.vocabulary_version,
            "robot_config_sha256": config.digest(),
            "tokens": tokens,
            "token_ids": [lookup[t] for t in tokens],
        },
        "vocabulary.json": {"version": config.vocabulary_version, "tokens": vocab},
        "timed_trajectory.json": {
            "schema_version": "timed-trajectory/2",
            "sessions": sessions,
            "session_transition": "reset; no physical transfer or elapsed transfer time",
        },
        "validation_report.json": report,
    }
    geometry = Encoder(floorplan, config)
    anchors = []
    for opening in floorplan.openings:
        center = geometry.center(opening)
        room_anchors = {
            room_id: shift(
                center,
                geometry.side(geometry.rooms[room_id], opening)[0],
                -Fraction(config.anchor_offset_mm),
            )
            for room_id in opening.room_ids
        }
        outside_anchor = None
        if opening.connects_outside:
            outside_anchor = shift(
                center,
                geometry.side(geometry.rooms[opening.room_ids[0]], opening)[0],
                Fraction(config.anchor_offset_mm),
            )
        anchors.append(
            {
                "opening_id": opening.id,
                "center_mm": center,
                "room_anchors_mm": room_anchors,
                "outside_anchor_mm": outside_anchor,
            }
        )
    artifacts["navigation_scene.json"] = {
        "schema_version": "navigation-scene/2",
        "polygon_semantics": config.polygon_semantics,
        "canonical_floorplan": floorplan.model_dump(mode="json"),
        "opening_anchors": anchors,
        "robot_config_sha256": config.digest(),
    }
    artifacts["building_summary.json"] = {
        "source_building_id": document.building_id,
        "canonical_room_count": len(floorplan.rooms),
        "canonical_wall_count": len(floorplan.walls),
        "canonical_opening_count": len(floorplan.openings),
        "indoor_component_count": report["component_count"],
        "source_ids_in_tokens": False,
        "normalization_exclusions": [
            "source IDs",
            "absolute translation",
            "editor bookkeeping",
            "display/local names",
            "room finishes/occupancy/heating",
            "opening review status",
            "outside environment",
            "orphan vertices",
        ],
    }
    schemas = {
        "robot_config.json": Config.model_json_schema(),
        "canonical_floorplan.json": CanonicalFloorplan.model_json_schema(),
        "reconstructed_floorplan.json": CanonicalFloorplan.model_json_schema(),
        "behavior_tokens.json": BehaviorTokens.model_json_schema(),
        "timed_trajectory.json": TimedTrajectory.model_json_schema(),
    }
    for name, schema in schemas.items():
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(json_value(artifacts[name]))
    report["schema_validation_count"] = len(schemas)
    artifacts["artifact_schemas.json"] = schemas
    output.parent.mkdir(parents=True, exist_ok=True)
    # Unique sibling staging directory; a failed filesystem operation stays visible
    # for diagnosis and is not silently cleaned or published as a valid building.
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    for name, value in artifacts.items():
        (staging / name).write_text(
            json.dumps(json_value(value), ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
    staging.rename(output)
    return json_value(report)  # type: ignore[no-any-return]
