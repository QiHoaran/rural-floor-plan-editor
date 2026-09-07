from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rural_data_prep.pipeline import clean_corpus


class FullCorpusIntegrationTest(unittest.TestCase):
    def test_all_465_buildings_match_the_accepted_corpus_baseline(self) -> None:
        repository = Path(__file__).resolve().parents[3]
        input_root = repository / "data" / "rural_data" / "JSON"
        if not input_root.is_dir():
            self.skipTest("External 465-building reference corpus is not installed")
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "cleaned"
            summary = clean_corpus(input_root, output_root)
            report = json.loads((output_root / "quality_report.json").read_text(encoding="utf-8"))

            self.assertEqual(summary["building_count"], 465)
            self.assertEqual(
                summary["entity_counts"],
                {"vertices": 5014, "walls": 6486, "rooms": 1937, "wall_elements": 4277, "relations": 4277},
            )
            self.assertEqual(report["workflow_status_counts"], {"complete": 465})
            self.assertEqual(report["plan_form_counts"], {"L 型": 150, "U 型": 6, "一字型": 309})
            self.assertNotIn("unknown", report["room_semantic_counts"])
            self.assertEqual(len(report["unknown_room_semantics"]), 0)
            self.assertTrue(all("original_function_code" in item for item in report["unknown_room_semantics"]))
            self.assertEqual(report["explicit_outside_region_count"], 0)
            self.assertEqual(report["repairs"]["repaired_wall_count"], 26)
            self.assertEqual(report["repairs"]["buildings_with_repairs"], 23)
            self.assertEqual(report["repairs"]["inferred_relation_count"], 6)
            self.assertEqual(report["repairs"]["normalized_opening_type_count"], 1)
            self.assertEqual(report["repairs"]["buildings_with_relation_repairs"], 3)
            self.assertEqual(report["repairs"]["source_area_mismatch_count"], 167)
            self.assertEqual(report["repairs"]["buildings_with_source_area_mismatch"], 48)
            self.assertLessEqual(report["repairs"]["maximum_single_axis_delta_mm"], 250)
            self.assertEqual(
                report["building_autosave_comparison"],
                {"paired_building_json_count": 169, "byte_equal_count": 169, "byte_different_count": 0},
            )
            self.assertEqual(len(list((output_root / "canonical").glob("*.json"))), 465)
            self.assertEqual(len(list((output_root / "training").glob("*.json"))), 465)
            self.assertEqual(len((output_root / "household/household.jsonl").read_text(encoding="utf-8").splitlines()), 465)

            manifest = json.loads((output_root / "manifest.json").read_text(encoding="utf-8"))
            by_building = {item["building_id"]: item for item in manifest["records"]}
            expected_repairs = {
                "rural_002_house_0029": 1,
                "rural_002_house_0031": 1,
                "rural_002_house_0051": 4,
            }
            for building_id, count in expected_repairs.items():
                canonical = json.loads(
                    (output_root / by_building[building_id]["canonical_file"]).read_text(encoding="utf-8")
                )
                self.assertEqual(len(canonical["repairs"]["relations"]), count)
                repaired_ids = {
                    item["wall_element_id"] for item in canonical["repairs"]["relations"]
                }
                related_ids = {item["wall_element_id"] for item in canonical["relations"]}
                self.assertLessEqual(repaired_ids, related_ids)

            for line in (output_root / "training.jsonl").read_text(encoding="utf-8").splitlines():
                record = json.loads(line)
                points = [
                    point
                    for room in record["rooms"]
                    for point in room["polygon"]
                ]
                points.extend(point for wall in record["walls"] for point in wall["segment"])
                points.extend(point for opening in record["openings"] for point in opening["segment"])
                self.assertTrue(all(8 <= coordinate <= 247 for point in points for coordinate in point))


if __name__ == "__main__":
    unittest.main()
