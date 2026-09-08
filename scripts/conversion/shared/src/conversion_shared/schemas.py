"""JSON Schema documents for the public cleaned-corpus record types."""

from __future__ import annotations

import re
from typing import Any


def validate_json_schema(value: Any, schema: dict[str, Any], *, path: str = "$") -> None:
    """Validate the JSON Schema subset used by the public corpus schemas."""

    expected_type = schema.get("type")
    type_matches = {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }
    if expected_type is not None and not type_matches.get(expected_type, False):
        raise ValueError(f"{path} must have JSON type {expected_type}")
    if "const" in schema and value != schema["const"]:
        raise ValueError(f"{path} must equal constant {schema['const']!r}")
    if isinstance(value, str) and "pattern" in schema and re.search(schema["pattern"], value) is None:
        raise ValueError(f"{path} does not match required pattern")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and "minimum" in schema:
        if value < schema["minimum"]:
            raise ValueError(f"{path} is below the minimum")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            raise ValueError(f"{path} has too few items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise ValueError(f"{path} has too many items")
        if "items" in schema:
            for index, item in enumerate(value):
                validate_json_schema(item, schema["items"], path=f"{path}[{index}]")
    if isinstance(value, dict):
        for required in schema.get("required", []):
            if required not in value:
                raise ValueError(f"{path}.{required} is required")
        properties = schema.get("properties", {})
        for key, child_schema in properties.items():
            if key in value:
                validate_json_schema(value[key], child_schema, path=f"{path}.{key}")
        additional = schema.get("additionalProperties", True)
        for key in value.keys() - properties.keys():
            if additional is False:
                raise ValueError(f"{path}.{key} is not an allowed property")
            if isinstance(additional, dict):
                validate_json_schema(value[key], additional, path=f"{path}.{key}")
    if "anyOf" in schema:
        for candidate in schema["anyOf"]:
            try:
                validate_json_schema(value, candidate, path=path)
                break
            except ValueError:
                continue
        else:
            raise ValueError(f"{path} must match at least one schema")
    if "not" in schema:
        try:
            validate_json_schema(value, schema["not"], path=path)
        except ValueError:
            pass
        else:
            raise ValueError(f"{path} must not match the forbidden schema")


def schema_documents() -> dict[str, dict[str, Any]]:
    base = "https://json-schema.org/draft/2020-12/schema"
    return {
        "canonical.schema.json": {
            "$schema": base,
            "$id": "rural-clean-canonical/1.0.0",
            "title": "CanonicalBuildingRecord 1.0.0",
            "type": "object",
            "required": ["schema_version", "record_id", "building_id", "source", "vertices", "walls", "wall_elements", "rooms", "relations", "derived", "repairs"],
            "properties": {
                "schema_version": {"const": "rural-clean-canonical/1.0.0"},
                "record_id": {"type": "string", "pattern": "^record_[0-9a-f]{16}$"},
                "building_id": {"type": "string"},
                "source": {
                    "type": "object",
                    "required": ["relative_path", "sha256", "input_schema_version", "workflow_status"],
                    "properties": {
                        "relative_path": {"type": "string"},
                        "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    },
                },
                "vertices": {
                    "type": "object",
                    "additionalProperties": {
                        "type": "object",
                        "required": ["x_mm", "y_mm"],
                        "properties": {"x_mm": {"type": "integer"}, "y_mm": {"type": "integer"}},
                    },
                },
                "walls": {"type": "array", "minItems": 1},
                "wall_elements": {"type": "array"},
                "rooms": {"type": "array", "minItems": 1},
                "relations": {"type": "array"},
                "derived": {
                    "type": "object",
                    "required": ["building_bbox_mm", "total_room_area_mm2", "occupied_boundary_components_mm", "room_adjacency", "outdoor_connections", "channel_edges"],
                },
                "repairs": {
                    "type": "object",
                    "required": ["rule_version", "repaired_wall_ids", "vertices", "relations"],
                    "properties": {"relations": {"type": "array"}},
                },
            },
        },
        "training.schema.json": {
            "$schema": base,
            "$id": "rural-floorplan-training/1.0.0",
            "title": "TrainingFloorplanRecord 1.0.0",
            "type": "object",
            "required": ["schema_version", "record_id", "conditions", "grid", "boundary_components", "rooms", "walls", "openings", "relations", "counts"],
            "properties": {
                "schema_version": {"const": "rural-floorplan-training/1.0.0"},
                "record_id": {"type": "string"},
                "grid": {
                    "type": "object",
                    "required": ["size", "padding", "north_is_positive_y", "transform"],
                    "properties": {
                        "size": {"const": 256},
                        "padding": {"const": 8},
                        "north_is_positive_y": {"const": True},
                        "transform": {
                            "type": "object",
                            "required": ["rotation_deg", "source_bbox_mm", "rotated_bbox_mm", "scale_mm_to_grid", "offset_grid", "rounding"],
                            "properties": {"rounding": {"const": "half_up"}},
                        },
                    },
                },
                "boundary_components": {"type": "array", "minItems": 1},
                "rooms": {"type": "array", "minItems": 1},
                "walls": {"type": "array", "minItems": 1},
                "openings": {"type": "array"},
                "relations": {"type": "array"},
            },
        },
        "household.schema.json": {
            "$schema": base,
            "$id": "rural-household-sidecar/1.0.0",
            "title": "HouseholdRecord 1.0.0",
            "type": "object",
            "required": ["schema_version", "record_id"],
            "properties": {
                "schema_version": {"const": "rural-household-sidecar/1.0.0"},
                "record_id": {"type": "string"},
                "gender": {},
                "age": {},
                "resident_count": {},
                "family_structure": {},
                "annual_income": {},
                "primary_income_source": {},
            },
            "not": {"anyOf": [{"required": ["building_id"]}, {"required": ["village_code"]}, {"required": ["household_code"]}]},
        },
        "manifest.schema.json": {
            "$schema": base,
            "$id": "rural-clean-manifest/1.0.0",
            "title": "CorpusManifest 1.0.0",
            "type": "object",
            "required": ["schema_version", "corpus_hash", "building_count", "records", "rules"],
            "properties": {
                "schema_version": {"const": "rural-clean-manifest/1.0.0"},
                "corpus_hash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "building_count": {"type": "integer", "minimum": 1},
                "records": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "required": ["building_id", "record_id", "source_relative_path", "source_sha256", "canonical_file", "canonical_sha256", "training_file", "training_sha256"],
                    },
                },
            },
        },
    }
