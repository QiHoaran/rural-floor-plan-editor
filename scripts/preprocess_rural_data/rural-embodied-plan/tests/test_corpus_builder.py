from __future__ import annotations

import hashlib
import json
from pathlib import Path
from editor_samples import sample_path, cleaned_root

import pytest
from test_canonical_loader import _canonical_from_raw

from rural_embodied_plan.config import default_config_path, load_config
from rural_embodied_plan.corpus import CorpusBuildError, build_corpus
from rural_embodied_plan.domain.robot import RobotActionType
from rural_embodied_plan.encoding.trajectory_encoder import encode_trajectory
from rural_embodied_plan.io.canonical_loader import load_canonical
from rural_embodied_plan.reconstruction.graph_builder import reconstruct_spatial_graph
from rural_embodied_plan.reconstruction.graph_validator import validate_roundtrip
from rural_embodied_plan.scene.scene_builder import build_scene
from rural_embodied_plan.traversal.explorer import generate_trajectory


def _write_cleaned_fixture(tmp_path: Path) -> tuple[Path, dict[str, object]]:
    raw_path = sample_path("rural_001_house_0001")
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    canonical = _canonical_from_raw(raw)
    root = tmp_path / "cleaned"
    canonical_path = root / "canonical/record.json"
    canonical_path.parent.mkdir(parents=True)
    encoded = (json.dumps(canonical, ensure_ascii=False, sort_keys=True) + "\n").encode()
    canonical_path.write_bytes(encoded)
    manifest = {
        "schema_version": "rural-clean-manifest/1.0.0",
        "corpus_hash": "a" * 64,
        "building_count": 1,
        "records": [
            {
                "building_id": raw["building_id"],
                "canonical_file": "canonical/record.json",
                "canonical_sha256": hashlib.sha256(encoded).hexdigest(),
            }
        ],
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (root / "quality_report.json").write_text(
        json.dumps(
            {
                "repairs": {
                    "repaired_wall_count": 0,
                    "source_area_mismatch_count": 0,
                    "inferred_relation_count": 0,
                    "normalized_opening_type_count": 0,
                }
            }
        ),
        encoding="utf-8",
    )
    return root, manifest


def test_build_corpus_publishes_six_artifacts_and_empty_exclusions(tmp_path: Path) -> None:
    input_root, manifest = _write_cleaned_fixture(tmp_path)
    output_root = tmp_path / "embodied"

    summary = build_corpus(input_root, output_root)

    building_dir = output_root / manifest["records"][0]["building_id"]
    assert len(list(building_dir.glob("*.json"))) == 6
    assert json.loads((output_root / "excluded_buildings.json").read_text())["buildings"] == []
    assert summary["valid_building_count"] == 1
    assert summary["excluded_building_count"] == 0
    assert summary["artifact_count"] == 6
    assert summary["schema_validation_count"] == 3


def test_hash_failure_writes_failure_report_without_partial_publication(tmp_path: Path) -> None:
    input_root, _ = _write_cleaned_fixture(tmp_path)
    output_root = tmp_path / "embodied"
    manifest_path = input_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["records"][0]["canonical_sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(CorpusBuildError, match="SHA-256"):
        build_corpus(input_root, output_root)

    assert not output_root.exists()
    failure = json.loads((tmp_path / "embodied.failure.json").read_text())
    assert failure["status"] == "failed"


def test_window_only_rooms_are_visual_nodes_and_windows_are_never_crossed() -> None:
    cleaned = cleaned_root()
    manifest = json.loads((cleaned / "manifest.json").read_text(encoding="utf-8"))
    record = next(
        item for item in manifest["records"] if item["building_id"] == "rural_004_house_0024"
    )
    document = load_canonical(cleaned / record["canonical_file"])
    settings = load_config(default_config_path())

    scene = build_scene(document, settings)
    trajectory = generate_trajectory(scene)

    visual = {
        activation.source_room_id
        for activation in trajectory.room_activations
        if activation.access_mode == "visual_only"
    }
    assert visual == {"face_0001", "face_0004"}
    window_ids = {
        opening.id for opening in scene.openings if opening.opening_type == "WINDOW"
    }
    crossed = {
        event.action.door_id
        for event in trajectory.events
        if event.action is not None and event.action.type == RobotActionType.CROSS_DOOR
    }
    assert window_ids.isdisjoint(crossed)
    tokens = encode_trajectory(trajectory, settings)
    assert validate_roundtrip(trajectory, reconstruct_spatial_graph(tokens)) == []
