from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from rural_data_prep.discovery import BuildingSource
from rural_data_prep.records import build_records


def sample_document() -> dict[str, object]:
    return {
        "schema_version": "future-version",
        "building_id": "rural_001_house_0001",
        "metadata": {"revision": 7},
        "workflow": {"status": "draft"},
        "site": {"north_angle_deg": 0},
        "survey": {
            "village_code": "001",
            "household_code": "0001",
            "gender": "女性",
            "age": 70,
            "plan_form": "一字型",
            "building_structure": "石结构",
        },
        "vertices": {
            "a": {"x_mm": 0, "y_mm": 0},
            "b": {"x_mm": 4000, "y_mm": 0},
            "c": {"x_mm": 4000, "y_mm": 3000},
            "d": {"x_mm": 0, "y_mm": 3000},
        },
        "walls": {
            "bottom": {"start_vertex_id": "a", "end_vertex_id": "b", "wall_type": "exterior", "thickness_mm": 240},
            "right": {"start_vertex_id": "b", "end_vertex_id": "c", "wall_type": "exterior", "thickness_mm": 240},
            "top": {"start_vertex_id": "c", "end_vertex_id": "d", "wall_type": "exterior", "thickness_mm": 240},
            "left": {"start_vertex_id": "d", "end_vertex_id": "a", "wall_type": "exterior", "thickness_mm": 240},
        },
        "wall_elements": {
            "door": {
                "element_type": "exterior_door",
                "host_wall_id": "bottom",
                "offset_from_start_mm": 1000,
                "width_mm": 900,
                "height_mm": 2100,
                "sill_height_mm": 0,
            }
        },
        "faces": {
            "room": {
                "boundary_vertex_ids": ["a", "b", "c", "d"],
                "area_mm2": 12_000_000,
                "function_code": "custom-kitchen",
                "display_name": "厨房",
            }
        },
        "outside_regions": {},
        "relations": [
            {
                "relation_type": "opening",
                "wall_element_id": "door",
                "from_face_id": "room",
                "to": {"kind": "outside"},
                "channels": {"people": True, "air": True, "light": True},
            }
        ],
        "floors": [{"floor_id": "floor_1", "wall_ids": ["bottom", "right", "top", "left"], "face_ids": ["room"]}],
        "custom_function_types": [],
        "future_top_level": {"keep": True},
    }


def source_for(document: dict[str, object]) -> BuildingSource:
    encoded = json.dumps(document, ensure_ascii=False).encode("utf-8")
    return BuildingSource(
        building_id=str(document["building_id"]),
        path=Path("source.json"),
        relative_path="rural_001_house_0001/draft/building.autosave.json",
        sha256=hashlib.sha256(encoded).hexdigest(),
        document=document,
    )


class RecordBuilderTest(unittest.TestCase):
    def test_builds_canonical_training_and_household_records(self) -> None:
        result = build_records(source_for(sample_document()))

        self.assertEqual(result.canonical["schema_version"], "rural-clean-canonical/1.0.0")
        self.assertEqual(result.canonical["architectural_survey"]["plan_form"], "一字型")
        self.assertNotIn("gender", result.canonical["architectural_survey"])
        self.assertEqual(result.canonical["rooms"][0]["semantic"], "kitchen")
        self.assertEqual(result.canonical["source_extensions"]["future_top_level"], {"keep": True})
        self.assertEqual(len(result.canonical["derived"]["outdoor_connections"]), 1)
        self.assertEqual(result.canonical["derived"]["room_adjacency"], [])
        self.assertEqual(
            result.canonical["derived"]["channel_edges"]["people"][0]["to"],
            {"kind": "outside"},
        )
        self.assertEqual(result.household["age"], 70)
        self.assertNotIn("building_id", result.household)
        self.assertNotIn("village_code", result.household)
        self.assertEqual(result.training["grid"]["size"], 256)
        self.assertEqual(len(result.training["boundary_components"]), 1)
        self.assertEqual(result.training["rooms"][0]["semantic"], "kitchen")
        self.assertEqual(result.training["openings"][0]["host_wall_index"], 0)
        self.assertEqual(result.training["relations"][0]["target"], {"kind": "outside"})
        self.assertEqual(result.metrics["wall_type_counts"], {"exterior": 4})
        self.assertEqual(result.metrics["opening_type_counts"], {"exterior_door": 1})
        self.assertEqual(result.metrics["building_dimensions_mm"], {"width": 4000, "height": 3000})
        self.assertLessEqual(result.metrics["grid_quantization_max_error_mm"], 12)
        self.assertEqual(result.canonical["repairs"]["relations"], [])

    def test_infers_missing_exterior_relation_from_single_room_host_wall(self) -> None:
        document = sample_document()
        document["relations"] = []

        result = build_records(source_for(document))

        self.assertEqual(
            result.canonical["relations"],
            [
                {
                    "relation_type": "opening",
                    "wall_element_id": "door",
                    "from_face_id": "room",
                    "to": {"kind": "outside"},
                    "channels": {"people": True, "air": True, "light": True},
                }
            ],
        )
        self.assertEqual(result.training["relations"][0]["target"], {"kind": "outside"})
        self.assertEqual(result.metrics["inferred_relation_count"], 1)

    def test_infers_two_room_window_without_making_it_traversable(self) -> None:
        document = self._two_room_document("exterior_window")

        result = build_records(source_for(document))

        relation = result.canonical["relations"][0]
        self.assertEqual(relation["from_face_id"], "east")
        self.assertEqual(relation["to"], {"kind": "face", "face_id": "west"})
        self.assertEqual(relation["channels"], {"people": False, "air": True, "light": True})
        self.assertEqual(result.canonical["wall_elements"][0]["element_type"], "exterior_window")
        self.assertEqual(result.canonical["repairs"]["relations"][0]["reason"], "missing_relation")

    def test_normalizes_two_room_exterior_door_and_preserves_source_type(self) -> None:
        document = self._two_room_document("exterior_door")

        result = build_records(source_for(document))

        element = result.canonical["wall_elements"][0]
        self.assertEqual(element["element_type"], "interior_door")
        self.assertEqual(element["source_element_type"], "exterior_door")
        self.assertEqual(result.canonical["relations"][0]["channels"]["people"], True)
        self.assertEqual(result.metrics["normalized_opening_type_count"], 1)

    def test_rejects_inference_when_host_wall_matches_no_room(self) -> None:
        document = sample_document()
        document["relations"] = []
        document["vertices"].update(
            {"x": {"x_mm": 5000, "y_mm": 0}, "y": {"x_mm": 5000, "y_mm": 3000}}
        )
        document["walls"]["detached"] = {
            "start_vertex_id": "x",
            "end_vertex_id": "y",
            "wall_type": "exterior",
            "thickness_mm": 240,
        }
        document["wall_elements"]["door"]["host_wall_id"] = "detached"

        with self.assertRaisesRegex(ValueError, "matches 0 room boundaries"):
            build_records(source_for(document))

    def test_rejects_inference_when_host_wall_matches_more_than_two_rooms(self) -> None:
        document = self._two_room_document("exterior_window")
        document["faces"]["third"] = dict(document["faces"]["west"])

        with self.assertRaisesRegex(ValueError, "matches 3 room boundaries"):
            build_records(source_for(document))

    @staticmethod
    def _two_room_document(element_type: str) -> dict[str, object]:
        document = sample_document()
        document["vertices"].update(
            {
                "e": {"x_mm": 2000, "y_mm": 0},
                "f": {"x_mm": 2000, "y_mm": 3000},
            }
        )
        document["walls"]["shared"] = {
            "start_vertex_id": "e",
            "end_vertex_id": "f",
            "wall_type": "interior",
            "thickness_mm": 120,
        }
        document["faces"] = {
            "west": {
                "boundary_vertex_ids": ["a", "e", "f", "d"],
                "area_mm2": 6_000_000,
                "function_code": "bedroom",
                "display_name": "卧室",
            },
            "east": {
                "boundary_vertex_ids": ["e", "b", "c", "f"],
                "area_mm2": 6_000_000,
                "function_code": "storage",
                "display_name": "杂物间",
            },
        }
        document["wall_elements"]["door"].update(
            {"element_type": element_type, "host_wall_id": "shared", "offset_from_start_mm": 900}
        )
        document["relations"] = []
        document["floors"][0]["wall_ids"].append("shared")
        document["floors"][0]["face_ids"] = ["west", "east"]
        return document

    def test_rejects_missing_wall_element_host(self) -> None:
        document = sample_document()
        document["wall_elements"]["door"]["host_wall_id"] = "missing"

        with self.assertRaisesRegex(ValueError, "missing host wall"):
            build_records(source_for(document))

    def test_room_order_uses_rotated_north_up_coordinates(self) -> None:
        document = sample_document()
        document["site"]["north_angle_deg"] = -90
        document["vertices"].update(
            {
                "e": {"x_mm": 2000, "y_mm": 0},
                "f": {"x_mm": 2000, "y_mm": 3000},
            }
        )
        document["faces"] = {
            "west": {
                "boundary_vertex_ids": ["a", "e", "f", "d"],
                "area_mm2": 6_000_000,
                "function_code": "bedroom",
                "display_name": "卧室",
            },
            "east": {
                "boundary_vertex_ids": ["e", "b", "c", "f"],
                "area_mm2": 6_000_000,
                "function_code": "kitchen",
                "display_name": "厨房",
            },
        }
        document["relations"][0]["from_face_id"] = "east"
        document["wall_elements"]["door"]["host_wall_id"] = "right"
        document["floors"][0]["face_ids"] = ["west", "east"]

        result = build_records(source_for(document))

        self.assertEqual([room["semantic"] for room in result.training["rooms"]], ["kitchen", "bedroom"])

    def test_rejects_relation_whose_host_wall_is_not_on_source_room(self) -> None:
        document = sample_document()
        document["vertices"].update(
            {
                "e": {"x_mm": 6000, "y_mm": 0},
                "f": {"x_mm": 7000, "y_mm": 0},
                "g": {"x_mm": 6000, "y_mm": 1000},
            }
        )
        document["faces"]["other"] = {
            "boundary_vertex_ids": ["e", "f", "g"],
            "area_mm2": 500_000,
            "function_code": "storage",
            "display_name": "杂物间",
        }
        document["relations"][0]["from_face_id"] = "other"
        document["floors"][0]["face_ids"].append("other")

        with self.assertRaisesRegex(ValueError, "not on from face"):
            build_records(source_for(document))

    def test_rejects_diagonal_host_between_nonadjacent_room_vertices(self) -> None:
        document = sample_document()
        document["walls"]["diagonal"] = {
            "start_vertex_id": "a",
            "end_vertex_id": "c",
            "wall_type": "interior",
            "thickness_mm": 120,
        }
        document["wall_elements"]["door"]["host_wall_id"] = "diagonal"
        document["floors"][0]["wall_ids"].append("diagonal")

        with self.assertRaisesRegex(ValueError, "not on from face"):
            build_records(source_for(document))


if __name__ == "__main__":
    unittest.main()
