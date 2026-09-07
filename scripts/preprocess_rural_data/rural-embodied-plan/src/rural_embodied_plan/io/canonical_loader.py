"""Load cleaned canonical records as the Embodied domain model."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from rural_embodied_plan.domain.building import BuildingDocument


def _without(value: dict[str, Any], *keys: str) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key not in keys}


def load_canonical(path: Path) -> BuildingDocument:
    """Convert one repaired cleaned canonical record to ``BuildingDocument``."""

    if not path.is_file():
        raise FileNotFoundError(f"Canonical JSON does not exist: {path}")
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid canonical JSON at {path}: {exc}") from exc
    if not isinstance(raw, dict) or raw.get("schema_version") != "rural-clean-canonical/1.0.0":
        raise ValueError(f"Unsupported cleaned canonical schema at {path}")
    if raw.get("coordinate_system", {}).get("storage_unit") != "mm":
        raise ValueError("Only millimetre cleaned canonical storage is supported")

    walls = {
        item["id"]: _without(item, "id", "length_mm", "direction")
        for item in raw.get("walls", [])
    }
    elements = {
        item["id"]: _without(
            item,
            "id",
            "segment_mm",
            "center_mm",
            "source_element_type",
        )
        for item in raw.get("wall_elements", [])
    }
    faces: dict[str, dict[str, Any]] = {}
    for room in raw.get("rooms", []):
        properties = room.get("properties", {})
        faces[room["id"]] = {
            "boundary_vertex_ids": room["boundary_vertex_ids"],
            "area_mm2": room["area_mm2"],
            "function_code": room.get("original_function_code") or room.get("semantic"),
            "display_name": room.get("display_name", ""),
            **properties,
        }
    outside_regions = {
        item["id"]: _without(item, "id") for item in raw.get("outside_regions", [])
    }
    converted = {
        "schema_version": raw["schema_version"],
        "building_id": raw["building_id"],
        "coordinate_system": raw["coordinate_system"],
        "vertices": raw.get("vertices", {}),
        "walls": walls,
        "wall_elements": elements,
        "faces": faces,
        "relations": raw.get("relations", []),
        "outside_regions": outside_regions,
        "canonical_repairs": raw.get("repairs", {}),
        "canonical_source": raw.get("source", {}),
    }
    try:
        return BuildingDocument.model_validate(converted)
    except ValidationError as exc:
        raise ValueError(f"Unsupported or invalid cleaned canonical: {exc}") from exc
