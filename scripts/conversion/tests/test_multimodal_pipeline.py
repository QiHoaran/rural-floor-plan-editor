from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from conversion_shared.convert import convert_modality
from conversion_shared.pipeline import _corpus_hash, stable_json_bytes
from conversion_shared.publication import (
    _PUBLICATION_MARKER,
    _PUBLICATION_MARKER_SCHEMA,
    _publication_lock,
)
from conversion_shared.records import build_records
from tests.test_records import sample_document, source_for


def write_cleaned_fixture(root: Path) -> None:
    source = source_for(sample_document())
    cleaned = build_records(source)
    canonical_bytes = stable_json_bytes(cleaned.canonical)
    training_bytes = stable_json_bytes(cleaned.training)
    canonical_file = "canonical/rural_001_house_0001.json"
    training_file = "training/rural_001_house_0001.json"
    (root / "canonical").mkdir(parents=True)
    (root / "training").mkdir(parents=True)
    (root / canonical_file).write_bytes(canonical_bytes)
    (root / training_file).write_bytes(training_bytes)
    manifest = {
        "schema_version": "rural-clean-manifest/1.0.0",
        "corpus_hash": _corpus_hash([source]),
        "building_count": 1,
        "records": [
            {
                "building_id": "rural_001_house_0001",
                "record_id": cleaned.canonical["record_id"],
                "source_relative_path": "rural_001_house_0001/draft/building.autosave.json",
                "source_sha256": source.sha256,
                "canonical_file": canonical_file,
                "canonical_sha256": hashlib.sha256(canonical_bytes).hexdigest(),
                "training_file": training_file,
                "training_sha256": hashlib.sha256(training_bytes).hexdigest(),
            }
        ],
        "rules": {},
    }
    (root / "manifest.json").write_bytes(stable_json_bytes(manifest))


class MultimodalPipelineTest(unittest.TestCase):
    def test_publishes_complete_graph_artifact_tree_and_refuses_overwrite(self) -> None:
        """Catches partial Graph publication or accidental overwrite of a completed corpus."""

        self.assertIsNotNone(convert_modality, "shared modality converter is missing")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "cleaned"
            output_root = root / "model_ready" / "graph"
            write_cleaned_fixture(input_root)

            summary = convert_modality("graph", input_root, output_root)

            self.assertEqual(summary.record_count, 1)
            self.assertEqual(summary.modality, "graph")
            self.assertEqual(
                {path.name for path in output_root.iterdir()},
                {
                    "rural_001_house_0001.json",
                    "graphs.jsonl",
                    "graph.schema.json",
                    "vocabulary.json",
                    "manifest.json",
                },
            )
            manifest = json.loads((output_root / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(
                manifest["source_corpus_hash"],
                _corpus_hash([source_for(sample_document())]),
            )
            self.assertEqual(manifest["records"][0]["building_id"], "rural_001_house_0001")
            self.assertIn("corpus_artifacts", manifest)
            self.assertEqual(
                {item["path"] for item in manifest["corpus_artifacts"]},
                {"graphs.jsonl", "graph.schema.json", "vocabulary.json"},
            )
            for artifact in manifest["corpus_artifacts"]:
                self.assertEqual(
                    artifact["sha256"],
                    hashlib.sha256((output_root / artifact["path"]).read_bytes()).hexdigest(),
                )
            with self.assertRaisesRegex(FileExistsError, "already exists"):
                convert_modality("graph", input_root, output_root)

    def test_dry_run_validates_without_creating_output(self) -> None:
        """Catches dry-run implementations that skip conversion or leave persistent files."""

        self.assertIsNotNone(convert_modality, "shared modality converter is missing")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "cleaned"
            output_root = root / "model_ready" / "image"
            write_cleaned_fixture(input_root)
            output_root.mkdir(parents=True)
            marker = output_root / "keep.txt"
            marker.write_text("unchanged", encoding="utf-8")

            try:
                summary = convert_modality("image", input_root, output_root, dry_run=True)
            except FileExistsError as error:
                self.fail(f"dry-run must ignore existing output: {error}")

            self.assertTrue(summary.dry_run)
            self.assertEqual(summary.record_count, 1)
            self.assertEqual(marker.read_text(encoding="utf-8"), "unchanged")
            self.assertEqual({path.name for path in output_root.iterdir()}, {"keep.txt"})

    def test_publishes_image_and_cad_trees_and_force_replaces_old_output(self) -> None:
        """Catches modality-specific omissions and force operations that merge stale files."""

        self.assertIsNotNone(convert_modality, "shared modality converter is missing")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "cleaned"
            write_cleaned_fixture(input_root)
            image_root = root / "model_ready" / "image"
            cad_root = root / "model_ready" / "cad"

            convert_modality("image", input_root, image_root)
            convert_modality("cad", input_root, cad_root)

            record_root = image_root / "rural_001_house_0001"
            self.assertEqual(
                {path.name for path in record_root.iterdir()},
                {"semantic.png", "instance.png", "stats.json"},
            )
            self.assertTrue((cad_root / "rural_001_house_0001.dxf").is_file())
            self.assertTrue((cad_root / "rural_001_house_0001.json").is_file())
            self.assertTrue((cad_root / "primitives.jsonl").is_file())
            stale = image_root / "stale.txt"
            stale.write_text("old", encoding="utf-8")

            convert_modality("image", input_root, image_root, force=True)

            self.assertFalse(stale.exists())
            self.assertTrue((image_root / "manifest.json").is_file())

    def test_recovers_interrupted_force_publication_and_tolerates_deferred_cleanup(self) -> None:
        """Catches crashes between backup and commit, plus false failure after a committed swap."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "cleaned"
            output_root = root / "model_ready" / "graph"
            backup = output_root.with_name(".graph.backup")
            write_cleaned_fixture(input_root)
            convert_modality("graph", input_root, output_root)
            backup.mkdir()
            precious = backup / "precious.txt"
            precious.write_text("not ours", encoding="utf-8")

            dry_summary = convert_modality("graph", input_root, output_root, dry_run=True)
            self.assertTrue(dry_summary.dry_run)
            self.assertEqual(precious.read_text(encoding="utf-8"), "not ours")
            with self.assertRaisesRegex(RuntimeError, "unauthenticated"):
                convert_modality("graph", input_root, output_root, force=True)
            self.assertEqual(precious.read_text(encoding="utf-8"), "not ours")
            precious.unlink()
            backup.rmdir()

            (output_root / "old.txt").write_text("recover me", encoding="utf-8")
            (output_root / _PUBLICATION_MARKER).write_bytes(
                stable_json_bytes(
                    {
                        "schema_version": _PUBLICATION_MARKER_SCHEMA,
                        "output_root": str(output_root.resolve()),
                    }
                )
            )
            output_root.replace(backup)

            with self.assertRaisesRegex(FileExistsError, "already exists"):
                convert_modality("graph", input_root, output_root)

            self.assertEqual((output_root / "old.txt").read_text(encoding="utf-8"), "recover me")
            self.assertFalse(backup.exists())

            real_rmtree = shutil.rmtree

            def defer_backup_cleanup(path: Path, *args: object, **kwargs: object) -> None:
                if Path(path) == backup:
                    raise PermissionError("simulated open handle")
                real_rmtree(path, *args, **kwargs)

            with mock.patch.object(shutil, "rmtree", side_effect=defer_backup_cleanup):
                summary = convert_modality("graph", input_root, output_root, force=True)

            self.assertEqual(summary.record_count, 1)
            self.assertTrue((output_root / "manifest.json").is_file())
            self.assertTrue(backup.exists())

    def test_publication_lock_serializes_same_output_identity(self) -> None:
        """Catches force publishers that can interleave recovery and directory swaps."""

        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "graph"
            first_entered = threading.Event()
            release_first = threading.Event()
            second_entered = threading.Event()

            def first_worker() -> None:
                with _publication_lock(output_root):
                    first_entered.set()
                    release_first.wait(timeout=5)

            def second_worker() -> None:
                first_entered.wait(timeout=5)
                with _publication_lock(output_root):
                    second_entered.set()

            first = threading.Thread(target=first_worker)
            second = threading.Thread(target=second_worker)
            first.start()
            second.start()
            self.assertTrue(first_entered.wait(timeout=5))
            time.sleep(0.05)
            self.assertFalse(second_entered.is_set())
            release_first.set()
            first.join(timeout=5)
            second.join(timeout=5)
            self.assertTrue(second_entered.is_set())


if __name__ == "__main__":
    unittest.main()
