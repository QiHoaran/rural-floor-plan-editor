from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rural_data_prep.discovery import discover_sources


class DiscoverSourcesTest(unittest.TestCase):
    def test_discovers_only_sorted_autosaves_without_workflow_filtering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for building_id, status, schema in [
                ("rural_002_house_0001", "draft", "future"),
                ("rural_001_house_0001", "complete", "2.1.0"),
            ]:
                project = root / building_id
                source = project / "draft" / "building.autosave.json"
                source.parent.mkdir(parents=True)
                source.write_text(
                    json.dumps(
                        {
                            "building_id": building_id,
                            "schema_version": schema,
                            "workflow": {"status": status},
                        }
                    ),
                    encoding="utf-8",
                )
                (project / "building.json").write_text("{}", encoding="utf-8")

            sources = discover_sources(root)

            self.assertEqual(
                [source.building_id for source in sources],
                ["rural_001_house_0001", "rural_002_house_0001"],
            )
            self.assertTrue(all(source.path.name == "building.autosave.json" for source in sources))

    def test_rejects_duplicate_building_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for project_name in ["first", "second"]:
                source = root / project_name / "draft" / "building.autosave.json"
                source.parent.mkdir(parents=True)
                source.write_text(json.dumps({"building_id": "duplicate"}), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "Duplicate building_id"):
                discover_sources(root)

    def test_preserves_source_path_order_even_when_ids_sort_differently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for project_name, building_id in [("a_project", "z_id"), ("z_project", "a_id")]:
                source = root / project_name / "draft" / "building.autosave.json"
                source.parent.mkdir(parents=True)
                source.write_text(json.dumps({"building_id": building_id}), encoding="utf-8")

            sources = discover_sources(root)

            self.assertEqual([source.relative_path for source in sources], [
                "a_project/draft/building.autosave.json",
                "z_project/draft/building.autosave.json",
            ])

    def test_rejects_building_id_that_is_not_a_safe_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "project" / "draft" / "building.autosave.json"
            source.parent.mkdir(parents=True)
            source.write_text(json.dumps({"building_id": "../escape"}), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "safe filename"):
                discover_sources(root)


if __name__ == "__main__":
    unittest.main()
