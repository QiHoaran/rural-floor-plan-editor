from __future__ import annotations

import hashlib
import copy
import json
import tempfile
import unittest
from pathlib import Path

from conversion_graph.graph import build_graph_record, graph_schema_document
from conversion_shared.corpus import load_cleaned_corpus
from conversion_shared.pipeline import _corpus_hash, stable_json_bytes
from conversion_shared.records import build_records
from conversion_shared.schemas import validate_json_schema
from conversion_shared.vocabulary import multimodal_vocabulary
from tests.test_records import sample_document, source_for


class GraphConversionTest(unittest.TestCase):
    def test_builds_training_graph_with_outside_node_and_typed_edge(self) -> None:
        """Catches missing stable node IDs, semantic IDs, or exterior-edge attributes."""

        self.assertIsNotNone(build_graph_record, "multimodal graph converter is missing")
        cleaned = build_records(source_for(sample_document()))

        graph = build_graph_record(cleaned.canonical, cleaned.training)

        self.assertEqual(graph["schema_version"], "rural-training-graph/1.0.0")
        self.assertEqual(graph["record_id"], "record_a329a21a452b28b6")
        self.assertEqual(
            graph["nodes"][0],
            {
                "node_index": 0,
                "kind": "outside",
                "kind_id": 0,
                "semantic": "none",
                "semantic_id": 0,
                "area_mm2": 0,
                "area_ratio": 0.0,
                "polygon_grid": [],
                "centroid_grid": None,
                "bbox_grid": None,
                "features": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            },
        )
        room = graph["nodes"][1]
        self.assertEqual(room["semantic"], "kitchen")
        self.assertEqual(room["semantic_id"], 3)
        self.assertEqual(room["polygon_grid"], [[8, 38], [247, 38], [247, 217], [8, 217]])
        self.assertEqual(room["area_ratio"], 1.0)
        self.assertEqual(room["centroid_grid"], [128, 128])
        self.assertEqual(room["bbox_grid"], [8, 38, 247, 217])
        self.assertEqual(room["features"][:3], [1.0, 3.0, 1.0])

        self.assertEqual(len(graph["edges"]), 1)
        edge = graph["edges"][0]
        self.assertEqual(edge["source"], 0)
        self.assertEqual(edge["target"], 1)
        self.assertEqual(edge["opening_type"], "exterior_door")
        self.assertEqual(edge["opening_type_id"], 1)
        self.assertEqual(edge["channels"], [1, 1, 1])
        self.assertTrue(edge["is_exterior"])
        self.assertEqual(graph["counts"], {"nodes": 2, "rooms": 1, "edges": 1})

    def test_loads_manifest_pairs_and_rejects_tampered_training_file(self) -> None:
        """Catches loaders that trust paths without verifying the published SHA-256 values."""

        self.assertIsNotNone(load_cleaned_corpus, "cleaned corpus loader is missing")
        source = source_for(sample_document())
        cleaned = build_records(source)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            canonical_path = root / "canonical" / "rural_001_house_0001.json"
            training_path = root / "training" / "rural_001_house_0001.json"
            canonical_path.parent.mkdir()
            training_path.parent.mkdir()
            canonical_bytes = stable_json_bytes(cleaned.canonical)
            training_bytes = stable_json_bytes(cleaned.training)
            canonical_path.write_bytes(canonical_bytes)
            training_path.write_bytes(training_bytes)
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
                        "canonical_file": "canonical/rural_001_house_0001.json",
                        "canonical_sha256": hashlib.sha256(canonical_bytes).hexdigest(),
                        "training_file": "training/rural_001_house_0001.json",
                        "training_sha256": hashlib.sha256(training_bytes).hexdigest(),
                    }
                ],
                "rules": {},
            }
            (root / "manifest.json").write_bytes(stable_json_bytes(manifest))

            corpus = load_cleaned_corpus(root)

            self.assertEqual(
                corpus.corpus_hash,
                _corpus_hash([source]),
            )
            self.assertEqual(len(corpus.records), 1)
            self.assertEqual(corpus.records[0].building_id, "rural_001_house_0001")
            self.assertEqual(corpus.records[0].canonical, cleaned.canonical)
            training_path.write_text(json.dumps({"tampered": True}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "training SHA-256 mismatch"):
                load_cleaned_corpus(root)
            training_path.write_bytes(training_bytes)
            manifest["records"][0]["source_sha256"] = "c" * 64
            (root / "manifest.json").write_bytes(stable_json_bytes(manifest))
            with self.assertRaisesRegex(ValueError, "corpus_hash mismatch"):
                load_cleaned_corpus(root)
            manifest["records"][0]["source_sha256"] = source.sha256
            altered_canonical = json.loads(canonical_bytes)
            altered_canonical["source"]["relative_path"] = "different/source.json"
            altered_bytes = stable_json_bytes(altered_canonical)
            canonical_path.write_bytes(altered_bytes)
            manifest["records"][0]["canonical_sha256"] = hashlib.sha256(altered_bytes).hexdigest()
            (root / "manifest.json").write_bytes(stable_json_bytes(manifest))
            with self.assertRaisesRegex(ValueError, "source lineage mismatch"):
                load_cleaned_corpus(root)

    def test_publishes_versioned_graph_schema_and_vocabulary(self) -> None:
        """Catches unversioned label drift or graph outputs missing required arrays."""

        self.assertIsNotNone(graph_schema_document, "graph schema builder is missing")
        self.assertIsNotNone(multimodal_vocabulary, "multimodal vocabulary builder is missing")
        cleaned = build_records(source_for(sample_document()))
        graph = build_graph_record(cleaned.canonical, cleaned.training)

        vocabulary = multimodal_vocabulary()
        schema = graph_schema_document()

        self.assertEqual(vocabulary["schema_version"], "rural-multimodal-vocabulary/1.0.0")
        self.assertEqual(vocabulary["room_semantics"]["kitchen"], 3)
        self.assertEqual(vocabulary["opening_types"]["exterior_window"], 4)
        validate_json_schema(graph, schema)
        invalid = dict(graph)
        invalid.pop("edges")
        with self.assertRaisesRegex(ValueError, "edges is required"):
            validate_json_schema(invalid, schema)
        malformed_node = copy.deepcopy(graph)
        malformed_node["nodes"][1]["features"].append(0.0)
        with self.assertRaisesRegex(ValueError, "too many items"):
            validate_json_schema(malformed_node, schema)

    def test_rejects_unsafe_and_reserved_building_ids_at_ingestion(self) -> None:
        """Catches staging-tree escapes and collisions with corpus-level artifact names."""

        self.assertIsNotNone(load_cleaned_corpus, "cleaned corpus loader is missing")
        cleaned = build_records(source_for(sample_document()))
        for unsafe_id, expected in (("../escape", "safe filename"), ("manifest", "reserved")):
            with self.subTest(building_id=unsafe_id), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                canonical = dict(cleaned.canonical)
                canonical["building_id"] = unsafe_id
                canonical_bytes = stable_json_bytes(canonical)
                training_bytes = stable_json_bytes(cleaned.training)
                (root / "canonical").mkdir()
                (root / "training").mkdir()
                (root / "canonical" / "record.json").write_bytes(canonical_bytes)
                (root / "training" / "record.json").write_bytes(training_bytes)
                manifest = {
                    "schema_version": "rural-clean-manifest/1.0.0",
                    "corpus_hash": "a" * 64,
                    "building_count": 1,
                    "records": [
                        {
                            "building_id": unsafe_id,
                            "record_id": canonical["record_id"],
                            "source_relative_path": "source/draft/building.autosave.json",
                            "source_sha256": "b" * 64,
                            "canonical_file": "canonical/record.json",
                            "canonical_sha256": hashlib.sha256(canonical_bytes).hexdigest(),
                            "training_file": "training/record.json",
                            "training_sha256": hashlib.sha256(training_bytes).hexdigest(),
                        }
                    ],
                    "rules": {},
                }
                (root / "manifest.json").write_bytes(stable_json_bytes(manifest))

                with self.assertRaisesRegex(ValueError, expected):
                    load_cleaned_corpus(root)


if __name__ == "__main__":
    unittest.main()
