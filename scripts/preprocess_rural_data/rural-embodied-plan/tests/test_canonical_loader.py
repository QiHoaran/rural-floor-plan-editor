from __future__ import annotations

import json
from pathlib import Path
from editor_samples import sample_path

from rural_embodied_plan.io.canonical_loader import load_canonical


def _canonical_from_raw(raw: dict[str, object]) -> dict[str, object]:
    rooms = []
    for face_id, face_value in raw["faces"].items():
        face = dict(face_value)
        rooms.append(
            {
                "id": face_id,
                "boundary_vertex_ids": face["boundary_vertex_ids"],
                "area_mm2": face["area_mm2"],
                "original_function_code": face.get("function_code"),
                "display_name": face.get("display_name", ""),
                "properties": {
                    key: value
                    for key, value in face.items()
                    if key
                    not in {"boundary_vertex_ids", "area_mm2", "function_code", "display_name"}
                },
            }
        )
    return {
        "schema_version": "rural-clean-canonical/1.0.0",
        "building_id": raw["building_id"],
        "coordinate_system": raw["coordinate_system"],
        "vertices": raw["vertices"],
        "walls": [{"id": key, **value} for key, value in raw["walls"].items()],
        "wall_elements": [
            {"id": key, **value} for key, value in raw["wall_elements"].items()
        ],
        "rooms": rooms,
        "relations": raw["relations"],
        "outside_regions": [],
        "repairs": {"vertices": [], "relations": []},
    }


def test_loader_uses_repaired_vertices_recomputed_area_and_canonical_relations(
    tmp_path: Path,
) -> None:
    source = sample_path("rural_001_house_0001")
    raw = json.loads(source.read_text(encoding="utf-8"))
    canonical = _canonical_from_raw(raw)
    vertex_id = sorted(canonical["vertices"])[0]
    canonical["vertices"][vertex_id]["x_mm"] += 17
    canonical["rooms"][0]["area_mm2"] += 123
    canonical["repairs"]["relations"] = [{"reason": "test-audit"}]
    path = tmp_path / "canonical.json"
    path.write_text(json.dumps(canonical, ensure_ascii=False), encoding="utf-8")

    document = load_canonical(path)

    assert document.vertices[vertex_id].x_mm == canonical["vertices"][vertex_id]["x_mm"]
    room_id = canonical["rooms"][0]["id"]
    assert document.faces[room_id].area_mm2 == canonical["rooms"][0]["area_mm2"]
    assert len(document.relations) == len(canonical["relations"])
    assert document.model_extra["canonical_repairs"]["relations"] == [
        {"reason": "test-audit"}
    ]
