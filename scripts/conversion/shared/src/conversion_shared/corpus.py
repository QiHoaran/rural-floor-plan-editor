"""Cleaned-corpus loading, authentication, and record types."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .io import _json_bytes, _load_hashed_json, _validate_building_id
from .schemas import schema_documents, validate_json_schema


@dataclass(frozen=True)
class CleanedRecord:
    building_id: str
    record_id: str
    canonical: dict[str, Any]
    training: dict[str, Any]


@dataclass(frozen=True)
class CleanedCorpus:
    input_root: Path
    corpus_hash: str
    manifest: dict[str, Any]
    records: tuple[CleanedRecord, ...]


def _recompute_cleaned_corpus_hash(manifest: dict[str, Any]) -> str:
    """Rebuild the cleaner's corpus identity from authenticated source lineage."""

    material = {
        "sources": [
            {
                "path": entry["source_relative_path"],
                "sha256": entry["source_sha256"],
            }
            for entry in manifest["records"]
        ],
        "rules": {
            "source": "*/draft/building.autosave.json",
            "repair": "near_axis_global_median_v1",
            "relation_inference": "host_wall_room_membership_v1",
            "explicit_relations_take_precedence": True,
            "max_short_axis_mm": 250,
            "min_aspect_ratio": 16,
            "grid_size": 256,
            "grid_padding": 8,
            "rounding": "half_up",
            "semantic_mapping": {
                "卧室": "bedroom",
                "客厅": "living_room",
                "厨房": "kitchen",
                "杂物间": "storage",
                "阳光房": "sunroom",
                "other": "unknown",
            },
            "public_schemas": schema_documents(),
        },
    }
    return hashlib.sha256(_json_bytes(material, pretty=False)).hexdigest()


def load_cleaned_corpus(input_root: Path) -> CleanedCorpus:
    """Load and authenticate every canonical/training pair from a cleaned manifest."""

    root = input_root.resolve()
    manifest = json.loads((root / "manifest.json").read_bytes())
    if not isinstance(manifest, dict):
        raise ValueError("Cleaned manifest must be a JSON object")
    schemas = schema_documents()
    validate_json_schema(manifest, schemas["manifest.schema.json"])
    for entry in manifest["records"]:
        _validate_building_id(str(entry["building_id"]))
    recomputed_corpus_hash = _recompute_cleaned_corpus_hash(manifest)
    if recomputed_corpus_hash != manifest["corpus_hash"]:
        raise ValueError("Cleaned manifest corpus_hash mismatch")
    records: list[CleanedRecord] = []
    building_ids: set[str] = set()
    record_ids: set[str] = set()
    for entry in manifest["records"]:
        building_id = str(entry["building_id"])
        record_id = str(entry["record_id"])
        _validate_building_id(building_id)
        if building_id in building_ids or record_id in record_ids:
            raise ValueError("Cleaned manifest contains duplicate building_id or record_id")
        canonical = _load_hashed_json(
            root,
            str(entry["canonical_file"]),
            str(entry["canonical_sha256"]),
            label="canonical",
        )
        training = _load_hashed_json(
            root,
            str(entry["training_file"]),
            str(entry["training_sha256"]),
            label="training",
        )
        validate_json_schema(canonical, schemas["canonical.schema.json"])
        validate_json_schema(training, schemas["training.schema.json"])
        if canonical.get("building_id") != building_id:
            raise ValueError(f"Canonical building_id mismatch for {building_id}")
        if canonical.get("record_id") != record_id or training.get("record_id") != record_id:
            raise ValueError(f"record_id mismatch for {building_id}")
        source = canonical.get("source", {})
        if (
            source.get("relative_path") != entry["source_relative_path"]
            or source.get("sha256") != entry["source_sha256"]
        ):
            raise ValueError(f"Canonical source lineage mismatch for {building_id}")
        records.append(
            CleanedRecord(
                building_id=building_id,
                record_id=record_id,
                canonical=canonical,
                training=training,
            )
        )
        building_ids.add(building_id)
        record_ids.add(record_id)
    if len(records) != int(manifest["building_count"]):
        raise ValueError("Cleaned manifest building_count does not match its records")
    return CleanedCorpus(
        input_root=root,
        corpus_hash=recomputed_corpus_hash,
        manifest=manifest,
        records=tuple(records),
    )
