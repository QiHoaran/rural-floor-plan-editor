from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from rural_data_prep.pipeline import CorpusBuildError, clean_corpus
from tests.test_records import sample_document


def write_source(root: Path, document: dict[str, object]) -> Path:
    building_id = str(document["building_id"])
    path = root / building_id / "draft" / "building.autosave.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def directory_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


class CorpusPipelineTest(unittest.TestCase):
    def test_dry_run_builds_records_without_writing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            write_source(input_root, sample_document())

            summary = clean_corpus(input_root, output_root, dry_run=True)

            self.assertEqual(summary["building_count"], 1)
            self.assertFalse(output_root.exists())

    def test_writes_complete_deterministic_artifact_tree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            first_output = root / "first"
            second_output = root / "second"
            write_source(input_root, sample_document())

            clean_corpus(input_root, first_output)
            clean_corpus(input_root, second_output)

            expected = {
                "canonical/rural_001_house_0001.json",
                "training/rural_001_house_0001.json",
                "household/household.jsonl",
                "schemas/canonical.schema.json",
                "schemas/training.schema.json",
                "schemas/household.schema.json",
                "schemas/manifest.schema.json",
                "canonical.jsonl",
                "training.jsonl",
                "manifest.json",
                "quality_report.json",
            }
            self.assertEqual(set(directory_hashes(first_output)), expected)
            self.assertEqual(directory_hashes(first_output), directory_hashes(second_output))
            per_file = json.loads((first_output / "canonical/rural_001_house_0001.json").read_text(encoding="utf-8"))
            jsonl = json.loads((first_output / "canonical.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(per_file, jsonl)
            report = json.loads((first_output / "quality_report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["wall_type_counts"], {"exterior": 4})
            self.assertEqual(report["opening_type_counts"], {"exterior_door": 1})
            self.assertEqual(report["building_dimension_ranges_mm"]["width"], {"min": 4000, "max": 4000})
            self.assertLessEqual(report["grid_quantization"]["max_error_mm"], 12)

    def test_refuses_existing_output_without_replace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            write_source(input_root, sample_document())
            output_root.mkdir()
            marker = output_root / "keep.txt"
            marker.write_text("keep", encoding="utf-8")

            with self.assertRaises(FileExistsError):
                clean_corpus(input_root, output_root)

            self.assertEqual(marker.read_text(encoding="utf-8"), "keep")

    def test_replace_atomically_replaces_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            write_source(input_root, sample_document())
            output_root.mkdir()
            (output_root / "obsolete.txt").write_text("obsolete", encoding="utf-8")

            clean_corpus(input_root, output_root, replace=True)

            self.assertFalse((output_root / "obsolete.txt").exists())
            self.assertTrue((output_root / "manifest.json").is_file())
            self.assertFalse((root / ".cleaned.backup").exists())

    def test_failure_writes_report_without_publishing_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            document = sample_document()
            document["wall_elements"]["door"]["host_wall_id"] = "missing"
            write_source(input_root, document)

            with self.assertRaises(CorpusBuildError):
                clean_corpus(input_root, output_root)

            self.assertFalse(output_root.exists())
            failure = json.loads((root / "cleaned.failure.json").read_text(encoding="utf-8"))
            self.assertEqual(failure["failed_count"], 1)
            self.assertIn("missing host wall", failure["failures"][0]["message"])

    def test_discovery_failure_writes_report_without_publishing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            source = input_root / "bad" / "draft" / "building.autosave.json"
            source.parent.mkdir(parents=True)
            source.write_text("{not-json", encoding="utf-8")

            with self.assertRaises(CorpusBuildError):
                clean_corpus(input_root, output_root)

            self.assertFalse(output_root.exists())
            failure = json.loads((root / "cleaned.failure.json").read_text(encoding="utf-8"))
            self.assertEqual(failure["failed_count"], 1)
            self.assertEqual(failure["failures"][0]["stage"], "discovery")

    def test_rejects_output_that_is_the_input_directory_without_touching_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            input_root = Path(directory) / "input"
            source = write_source(input_root, sample_document())

            with self.assertRaisesRegex(ValueError, "must be separate"):
                clean_corpus(input_root, input_root, replace=True)

            self.assertTrue(source.is_file())

    def test_staging_failure_writes_report_and_does_not_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            write_source(input_root, sample_document())

            with patch("rural_data_prep.pipeline._validate_written_tree", side_effect=RuntimeError("verify failed")):
                with self.assertRaises(CorpusBuildError):
                    clean_corpus(input_root, output_root)

            self.assertFalse(output_root.exists())
            failure = json.loads((root / "cleaned.failure.json").read_text(encoding="utf-8"))
            self.assertEqual(failure["failures"][0]["stage"], "write_validate_publish")


if __name__ == "__main__":
    unittest.main()
