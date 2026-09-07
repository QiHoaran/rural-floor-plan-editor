from __future__ import annotations

import unittest

from rural_data_prep.geometry import (
    derive_polygon,
    repair_near_axis_geometry,
    validate_geometry,
)


class NearAxisRepairTest(unittest.TestCase):
    def test_repairs_qualifying_wall_with_shared_vertex_constraints(self) -> None:
        vertices = {
            "a": {"x_mm": 0, "y_mm": 0},
            "b": {"x_mm": 100, "y_mm": 2000},
            "c": {"x_mm": 2000, "y_mm": 2000},
            "d": {"x_mm": 2000, "y_mm": 0},
        }
        walls = {
            "left": {"start_vertex_id": "a", "end_vertex_id": "b"},
            "top": {"start_vertex_id": "b", "end_vertex_id": "c"},
            "right": {"start_vertex_id": "c", "end_vertex_id": "d"},
            "bottom": {"start_vertex_id": "d", "end_vertex_id": "a"},
        }

        result = repair_near_axis_geometry(vertices, walls)

        self.assertEqual(result.vertices["a"]["x_mm"], 50)
        self.assertEqual(result.vertices["b"]["x_mm"], 50)
        self.assertEqual(result.repaired_wall_ids, ["left"])
        self.assertEqual({entry["vertex_id"] for entry in result.repairs}, {"a", "b"})
        self.assertEqual(validate_geometry(result.vertices, walls, {}), [])

    def test_preserves_nonqualifying_diagonal_wall(self) -> None:
        vertices = {
            "a": {"x_mm": 0, "y_mm": 0},
            "b": {"x_mm": 500, "y_mm": 2000},
        }
        walls = {"diagonal": {"start_vertex_id": "a", "end_vertex_id": "b"}}

        result = repair_near_axis_geometry(vertices, walls)

        self.assertEqual(result.vertices, vertices)
        self.assertEqual(result.repairs, [])
        self.assertEqual(result.repaired_wall_ids, [])

    def test_rejects_constraint_group_that_would_move_a_vertex_over_limit(self) -> None:
        vertices = {
            "a": {"x_mm": 0, "y_mm": 0},
            "b": {"x_mm": 250, "y_mm": 5000},
            "c": {"x_mm": 500, "y_mm": 10000},
            "d": {"x_mm": 750, "y_mm": 15000},
        }
        walls = {
            "one": {"start_vertex_id": "a", "end_vertex_id": "b"},
            "two": {"start_vertex_id": "b", "end_vertex_id": "c"},
            "three": {"start_vertex_id": "c", "end_vertex_id": "d"},
        }

        with self.assertRaisesRegex(ValueError, "exceeds 250 mm"):
            repair_near_axis_geometry(vertices, walls)


class DerivedGeometryTest(unittest.TestCase):
    def test_detects_distinct_vertex_ids_collapsed_to_same_coordinate(self) -> None:
        vertices = {
            "a": {"x_mm": 0, "y_mm": 0},
            "b": {"x_mm": 0, "y_mm": 0},
        }

        issues = validate_geometry(vertices, {}, {})

        self.assertTrue(any("share coordinates" in issue for issue in issues))

    def test_derives_bbox_area_and_centroid_for_polygon(self) -> None:
        vertices = {
            "a": {"x_mm": 0, "y_mm": 0},
            "b": {"x_mm": 4000, "y_mm": 0},
            "c": {"x_mm": 4000, "y_mm": 3000},
            "d": {"x_mm": 0, "y_mm": 3000},
        }

        derived = derive_polygon(["a", "b", "c", "d"], vertices)

        self.assertEqual(derived["bbox_mm"], [0, 0, 4000, 3000])
        self.assertEqual(derived["area_mm2"], 12_000_000)
        self.assertEqual(derived["centroid_mm"], [2000, 1500])

    def test_detects_self_intersecting_face(self) -> None:
        vertices = {
            "a": {"x_mm": 0, "y_mm": 0},
            "b": {"x_mm": 2000, "y_mm": 2000},
            "c": {"x_mm": 0, "y_mm": 2000},
            "d": {"x_mm": 2000, "y_mm": 0},
        }
        faces = {"bowtie": {"boundary_vertex_ids": ["a", "b", "c", "d"]}}

        issues = validate_geometry(vertices, {}, faces)

        self.assertTrue(any("self-intersects" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
