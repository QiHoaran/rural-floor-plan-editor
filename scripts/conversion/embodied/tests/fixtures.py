"""Shared test fixtures: a synthetic raw building and the external cleaned corpus."""

import json
import shutil
from pathlib import Path

import pytest


def raw_rectangle():
    return {
        "schema_version": "2.1",
        "building_id": "test",
        "coordinate_system": {"storage_unit": "mm"},
        "vertices": {
            k: {"x_mm": x, "y_mm": y}
            for k, x, y in [("a", 100, 200), ("b", 4100, 200), ("c", 4100, 3200), ("d", 100, 3200)]
        },
        "walls": {
            str(i): {
                "start_vertex_id": a,
                "end_vertex_id": b,
                "wall_type": "exterior",
                "thickness_mm": 200,
                "height_mm": 2800,
                "material_type": "brick",
            }
            for i, (a, b) in enumerate([("a", "b"), ("b", "c"), ("c", "d"), ("d", "a")])
        },
        "faces": {
            "room": {
                "boundary_vertex_ids": ["a", "b", "c", "d"],
                "area_mm2": 12000000,
                "function_code": None,
                "display_name": "ignored",
            }
        },
        "wall_elements": {
            "door": {
                "element_type": "exterior_door",
                "host_wall_id": "0",
                "offset_from_start_mm": 1000,
                "width_mm": 901,
                "height_mm": 2100,
                "sill_height_mm": 0,
                "status": "valid",
            }
        },
        "relations": [
            {
                "relation_type": "opening",
                "wall_element_id": "door",
                "from_face_id": "room",
                "to": {"kind": "outside"},
                "channels": {"people": True, "air": True, "light": True},
            }
        ],
    }


def cleaned_root() -> Path:
    root = Path(__file__).resolve().parents[4] / "data/rural_data/cleaned"
    if not (root / "manifest.json").is_file():
        pytest.skip("External cleaned corpus manifest is not installed")
    return root


def _two_record_fixture(tmp_path: Path) -> Path:
    source_root = cleaned_root()
    source_manifest = json.loads((source_root / "manifest.json").read_text(encoding="utf-8"))
    wanted = {"rural_001_house_0001", "rural_001_house_0015"}
    records = [record for record in source_manifest["records"] if record["building_id"] in wanted]
    assert {record["building_id"] for record in records} == wanted

    input_root = tmp_path / "cleaned"
    for record in records:
        relative = Path(record["canonical_file"])
        destination = input_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_root / relative, destination)
    manifest = {
        **source_manifest,
        "building_count": len(records),
        "records": records,
    }
    (input_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    return input_root
