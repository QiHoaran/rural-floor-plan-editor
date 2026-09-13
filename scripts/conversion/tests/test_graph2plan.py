from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path

import numpy as np
import scipy.io as sio
from conversion_graph2plan.corpus import (
    build_corpus,
    deterministic_digest,
    write_split_mat,
)
from conversion_graph2plan.graph2plan import (
    MAT_FIELDS,
    build_boundary,
    build_sample,
    edge_predicate,
    mat_record,
    quarantine_code,
    room_order,
    validate_record,
)
from conversion_graph2plan.vocabulary import RURAL_TO_GRAPH2PLAN, room_type
from conversion_shared.records import build_records
from conversion_shared.split import (
    SPLIT_BUCKETS,
    TRAIN_BELOW,
    VALID_BELOW,
    dataset_split,
    split_bucket,
    split_name,
)
from test_records import sample_document, source_for

CONVERSION_ROOT = Path(__file__).resolve().parent.parent


def row_of_rooms(count: int) -> dict:
    """A one-storey row of ``count`` equal rooms, connected by interior doors."""

    width = 3000
    doc = sample_document()
    vertices = {}
    for index in range(count + 1):
        vertices[f"lo{index}"] = {"x_mm": index * width, "y_mm": 0}
        vertices[f"hi{index}"] = {"x_mm": index * width, "y_mm": 3000}
    doc["vertices"] = vertices
    walls = {
        "bottom0": {"start_vertex_id": "lo0", "end_vertex_id": "lo1", "wall_type": "exterior", "thickness_mm": 240},
        "top0": {"start_vertex_id": f"hi{count}", "end_vertex_id": f"lo{count}", "wall_type": "exterior", "thickness_mm": 240},
    }
    for index in range(1, count):
        walls[f"bottom{index}"] = {"start_vertex_id": f"lo{index}", "end_vertex_id": f"lo{index+1}", "wall_type": "exterior", "thickness_mm": 240}
    for index in range(1, count):
        walls[f"top{index}"] = {"start_vertex_id": f"hi{index}", "end_vertex_id": f"hi{index-1}", "wall_type": "exterior", "thickness_mm": 240}
    walls["left"] = {"start_vertex_id": "hi0", "end_vertex_id": "lo0", "wall_type": "exterior", "thickness_mm": 240}
    walls["right"] = {"start_vertex_id": f"lo{count}", "end_vertex_id": f"hi{count}", "wall_type": "exterior", "thickness_mm": 240}
    for index in range(1, count):
        walls[f"split{index}"] = {"start_vertex_id": f"lo{index}", "end_vertex_id": f"hi{index}", "wall_type": "interior", "thickness_mm": 240}
    doc["walls"] = walls
    doc["faces"] = {
        f"r{index}": {
            "boundary_vertex_ids": [f"lo{index}", f"lo{index+1}", f"hi{index+1}", f"hi{index}"],
            "area_mm2": width * 3000,
            "function_code": code,
            "display_name": name,
        }
        for index, (code, name) in enumerate(
            [("living_room", "客厅"), ("bedroom", "卧室")] + [("bedroom", "卧室")] * max(0, count - 2)
        )
    }
    doc["wall_elements"] = {
        "we_front": {
            "element_type": "exterior_door",
            "host_wall_id": "bottom0",
            "offset_from_start_mm": 900,
            "width_mm": 1200,
            "height_mm": 2100,
            "sill_height_mm": 0,
        }
    }
    relations = [
        {
            "relation_type": "opening",
            "wall_element_id": "we_front",
            "from_face_id": "r0",
            "to": {"kind": "outside"},
            "channels": {"people": True, "air": True, "light": True},
        }
    ]
    for index in range(1, count):
        element = f"we_in{index}"
        doc["wall_elements"][element] = {
            "element_type": "interior_door",
            "host_wall_id": f"split{index}",
            "offset_from_start_mm": 1000,
            "width_mm": 1000,
            "height_mm": 2100,
            "sill_height_mm": 0,
        }
        relations.append(
            {
                "relation_type": "connection",
                "wall_element_id": element,
                "from_face_id": f"r{index-1}",
                "to": {"kind": "face", "face_id": f"r{index}"},
                "channels": {"people": True, "air": True, "light": False},
            }
        )
    doc["relations"] = relations
    doc["floors"] = [
        {
            "floor_id": "floor_1",
            "wall_ids": list(walls),
            "face_ids": list(doc["faces"]),
        }
    ]
    doc["workflow"] = {"status": "complete"}
    return doc


def canonical_for(document: dict) -> dict:
    return build_records(source_for(document)).canonical


class VocabularyTest(unittest.TestCase):
    def test_every_rural_semantic_maps_inside_the_model_label_space(self) -> None:
        self.assertEqual(
            RURAL_TO_GRAPH2PLAN,
            {"living_room": 0, "bedroom": 7, "kitchen": 2, "storage": 11, "sunroom": 9},
        )
        for semantic in RURAL_TO_GRAPH2PLAN:
            self.assertTrue(0 <= room_type(semantic) <= 12)

    def test_unknown_semantic_is_refused_rather_than_guessed(self) -> None:
        with self.assertRaisesRegex(ValueError, "GRAPH2PLAN_UNMAPPED_ROOM"):
            room_type("unknown")
        self.assertIsNone(quarantine_code(ValueError("GRAPH2PLAN_UNKNOWN_THING: x")))


class RoomOrderTest(unittest.TestCase):
    def test_tie_broken_overlap_chain_matches_regularize_fp(self) -> None:
        # Four boxes in a row; only the third is narrower, so the overlap precedence
        # flips around it. Expected sequence was cross-checked against hand-applied
        # regularize_fp.m semantics for rural_001_house_0001.
        boxes = [[8, 82, 69, 174], [68, 82, 129, 174], [128, 82, 188, 174], [187, 82, 248, 174]]
        areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in boxes]
        self.assertEqual(room_order(boxes, areas), [4, 2, 3, 1])

    def test_without_overlap_the_identity_is_reversed(self) -> None:
        boxes = [[0, 0, 10, 10], [50, 0, 60, 10], [100, 0, 110, 10]]
        areas = [100, 100, 100]
        self.assertEqual(room_order(boxes, areas), [3, 2, 1])

    def test_order_is_a_one_based_permutation(self) -> None:
        for count in (2, 3, 4, 5, 7):
            sample = build_sample(canonical_for(row_of_rooms(count)))
            self.assertEqual(sorted(sample.order), list(range(1, count + 1)))


class EdgePredicateTest(unittest.TestCase):
    def test_reproduces_upstream_point_box_relation(self) -> None:
        # (y0, x0, y1, x1) boxes, as FloorPlan.get_triples builds them.
        left = [0, 0, 10, 10]
        right = [0, 20, 10, 30]
        self.assertEqual(edge_predicate([left, right], 0, 1), 2)  # left-of
        self.assertEqual(edge_predicate([left, right], 1, 0), 7)  # right-of
        inner = [2, 2, 8, 8]
        outer = [0, 0, 10, 10]
        self.assertEqual(edge_predicate([outer, inner], 0, 1), 5)  # surrounding
        self.assertEqual(edge_predicate([outer, inner], 1, 0), 4)  # inside


class BoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sample = build_sample(canonical_for(row_of_rooms(3)))

    def test_front_door_occupies_the_first_two_boundary_rows(self) -> None:
        self.assertEqual(self.sample.boundary[0][:2], self.sample.door_grid[0])
        self.assertEqual(self.sample.boundary[1][:2], self.sample.door_grid[1])
        # RPLAN marks the inserted door points isNew so regularize_fp can rebuild the
        # polygon from boundary(~isNew).
        self.assertEqual([row[3] for row in self.sample.boundary[:2]], [1, 1])

    def test_non_flagged_points_still_close_the_envelope(self) -> None:
        corners = [row[:2] for row in self.sample.boundary if row[3] == 0]
        self.assertGreaterEqual(len(corners), 4)
        self.assertEqual(len({tuple(point) for point in corners}), len(corners))

    def test_every_edge_is_axis_aligned_and_dir_is_in_range(self) -> None:
        self.assertTrue(all(row[2] in (0, 1, 2, 3) for row in self.sample.boundary))

    def test_diagonal_envelope_is_rejected(self) -> None:
        loop = [[0, 0], [10, 10], [10, 20], [0, 20]]
        door = type(self.sample.chosen_entrance)(
            element_id="d",
            face_id="r0",
            face_semantic="living_room",
            host_wall_id="w",
            host_wall_length_mm=1.0,
            segment_grid=([0, 0], [4, 4]),
            rank_key=(0, 0, 0, 0, "d"),
        )
        with self.assertRaisesRegex(ValueError, "GRAPH2PLAN_DIAGONAL_BOUNDARY"):
            build_boundary(loop, door)


class GraphTest(unittest.TestCase):
    def test_rEdge_reuses_the_door_mediated_room_graph(self) -> None:
        sample = build_sample(canonical_for(row_of_rooms(3)))
        self.assertEqual([(edge["u"], edge["v"]) for edge in sample.edges], [(0, 1), (1, 2)])
        self.assertTrue(all(edge["wall_element_ids"] for edge in sample.edges))

    def test_bbox_comparison_is_reported_not_substituted(self) -> None:
        sample = build_sample(canonical_for(row_of_rooms(4)))
        comparison = sample.comparison
        self.assertGreaterEqual(comparison["bbox_overlap_edge_count"], comparison["door_based_edge_count"])
        self.assertIn("bbox_only", comparison)

    def test_single_adjacency_is_exported_without_padding(self) -> None:
        record = mat_record(build_sample(canonical_for(row_of_rooms(2))))
        validate_record(record)
        self.assertEqual(len(record["rEdge"]), 1)
        self.assertEqual(record["rEdge"][0][:2], [0, 1])

    def test_zero_adjacency_is_still_quarantined(self) -> None:
        canonical = canonical_for(row_of_rooms(2))
        canonical["derived"]["room_adjacency"] = []
        with self.assertRaisesRegex(ValueError, "GRAPH2PLAN_DEGENERATE_GRAPH") as caught:
            build_sample(canonical)
        self.assertEqual(quarantine_code(caught.exception), "GRAPH2PLAN_DEGENERATE_GRAPH")

    def test_multiple_entrances_are_ranked_and_all_recorded(self) -> None:
        document = row_of_rooms(3)
        document["wall_elements"]["we_back"] = {
            "element_type": "exterior_door",
            "host_wall_id": "bottom2",
            "offset_from_start_mm": 500,
            "width_mm": 900,
            "height_mm": 2100,
            "sill_height_mm": 0,
        }
        document["relations"].append(
            {
                "relation_type": "opening",
                "wall_element_id": "we_back",
                "from_face_id": "r2",
                "to": {"kind": "outside"},
                "channels": {"people": True, "air": True, "light": True},
            }
        )
        sample = build_sample(canonical_for(document))
        self.assertEqual(len(sample.entrances), 2)
        # The chosen door serves r0, the living room, so it wins on host priority.
        self.assertEqual(sample.chosen_entrance.face_semantic, "living_room")
        self.assertTrue(any("MULTIPLE_ENTRANCES" in warning for warning in sample.warnings))

    def test_record_passes_its_own_schema_and_matches_the_mat_fields(self) -> None:
        record = mat_record(build_sample(canonical_for(row_of_rooms(4))))
        validate_record(record)
        self.assertEqual(set(record), set(MAT_FIELDS))
        self.assertEqual(len(record["rType"]), len(record["gtBoxNew"]))


class MatExportTest(unittest.TestCase):
    def test_single_edge_roundtrip_and_predicate_audit(self) -> None:
        from conversion_graph2plan.official_loader import _stored_predicates

        samples = [
            replace(build_sample(canonical_for(row_of_rooms(count))), building_id=f"rooms_{count}")
            for count in (2, 3)
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "data_valid.mat"
            write_split_mat(path, samples)
            data = sio.loadmat(str(path), squeeze_me=True, struct_as_record=False)["data"]
            self.assertEqual(data[0].rEdge.shape, (3,))
            np.testing.assert_array_equal(data[0].rEdge, mat_record(samples[0])["rEdge"][0])
            self.assertEqual(
                _stored_predicates(path),
                {sample.building_id: [edge["predicate"] for edge in sample.edges] for sample in samples},
            )

    def test_official_loadmat_options_read_the_split_back(self) -> None:
        samples = [build_sample(canonical_for(row_of_rooms(count))) for count in (3, 5)]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "data_train.mat"
            write_split_mat(path, samples)
            data = sio.loadmat(str(path), squeeze_me=True, struct_as_record=False)["data"]
            self.assertEqual(len(data), 2)
            first = data[0]
            self.assertEqual(first.name, samples[0].building_id)
            self.assertEqual(first.boundary.shape[1], 4)
            self.assertEqual(first.rType.shape[0], len(samples[0].rooms))
            self.assertEqual(first.gtBoxNew.shape, (len(samples[0].rooms), 4))
            self.assertEqual(first.order.shape[0], len(samples[0].rooms))
            # Multi-edge arrays are unchanged by scipy's squeeze_me option.
            self.assertEqual(first.rEdge.shape, (len(samples[0].edges), 3))
            pairs = [(int(u), int(v)) for u, v, _ in first.rEdge]
            self.assertEqual(pairs, [(e["u"], e["v"]) for e in samples[0].edges])
            self.assertEqual(len(first.rBoundary), len(samples[0].rooms))
            self.assertEqual(np.asarray(first.rBoundary[0]).shape[1], 2)


class SplitTest(unittest.TestCase):
    def test_assignment_is_deterministic_and_bucketed(self) -> None:
        ids = [f"rural_{index:03d}_house_0001" for index in range(1, 120)]
        first = dataset_split(ids)
        self.assertEqual(first, dataset_split(ids))
        for building_id, name in first.items():
            bucket = split_bucket(building_id)
            self.assertLess(bucket, SPLIT_BUCKETS)
            expected = "train" if bucket < TRAIN_BELOW else ("valid" if bucket < VALID_BELOW else "test")
            self.assertEqual(name, expected)

    def test_growth_does_not_move_existing_buildings(self) -> None:
        ids = [f"rural_{index:03d}_house_0001" for index in range(1, 60)]
        before = dataset_split(ids)
        after = dataset_split(ids + ["rural_999_house_0001"])
        self.assertEqual({key: after[key] for key in before}, before)

    def test_duplicate_ids_are_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "Duplicate building id"):
            dataset_split(["a", "a"])


def ids_covering_every_split(per_split: int = 3) -> dict[str, list[str]]:
    """Pick building ids until each hash bucket holds ``per_split`` of them.

    A tiny corpus can otherwise land entirely in one bucket, which the exporter
    correctly refuses to publish.
    """

    chosen: dict[str, list[str]] = {"train": [], "valid": [], "test": []}
    index = 0
    while any(len(bucket) < per_split for bucket in chosen.values()):
        building_id = f"rural_{index:04d}_house_0001"
        bucket = chosen[split_name(building_id)]
        if len(bucket) < per_split:
            bucket.append(building_id)
        index += 1
        if index > 2000:
            raise AssertionError("could not populate every split bucket")
    return chosen


class CorpusTest(unittest.TestCase):
    def build(self, temporary: str) -> Path:
        data_root = Path(temporary) / "data"
        for index, building_id in enumerate(
            [item for bucket in ids_covering_every_split().values() for item in bucket]
        ):
            document = row_of_rooms(3 + index % 3)
            document["building_id"] = building_id
            directory = data_root / building_id
            directory.mkdir(parents=True)
            (directory / "building.json").write_text(
                json.dumps(document, ensure_ascii=False), encoding="utf-8"
            )
        return data_root

    def test_publishes_three_splits_with_traceable_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "out"
            manifest = build_corpus(self.build(temporary), root, preview_limit=2)
            self.assertEqual(manifest["sample_count"], 9)
            self.assertEqual(sum(manifest["splits"].values()), 9)
            self.assertTrue(all(count > 0 for count in manifest["splits"].values()))
            for name in ("train", "valid", "test"):
                self.assertTrue((root / "data" / f"data_{name}.mat").is_file())
            for path in ("manifest.json", "quality_report.json", "split.json", "exclusions.json"):
                self.assertTrue((root / path).is_file())
            for sample in sorted((root / "samples").glob("*.json")):
                payload = json.loads(sample.read_text(encoding="utf-8"))
                validate_record(payload["record"])
                self.assertTrue((root / "mapping" / sample.name).is_file())
                self.assertTrue((root / "preview" / sample.name.replace(".json", ".png")).is_file())

    def test_repeated_run_is_byte_identical(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            data_root = self.build(temporary)
            first, second = Path(temporary) / "a", Path(temporary) / "b"
            build_corpus(copy.deepcopy(data_root), first, preview_limit=1)
            # scipy stamps the MAT v5 header with the local wall clock, so the two runs
            # must straddle a second: otherwise this passes even with the bug present.
            time.sleep(1.2)
            build_corpus(copy.deepcopy(data_root), second, preview_limit=1)
            self.assertEqual(deterministic_digest(first), deterministic_digest(second))

    def test_mat_header_carries_no_timestamp(self) -> None:
        samples = [build_sample(canonical_for(row_of_rooms(4))), build_sample(canonical_for(row_of_rooms(3)))]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "data_train.mat"
            write_split_mat(path, samples)
            header = path.read_bytes()[:128]
            self.assertNotIn(b"Created on:", header)
            # Everything after the text field must be untouched: 0x0100 little-endian
            # version, then the "IM" endian indicator that marks a valid MAT v5 file.
            self.assertEqual(header[124:126], b"\x00\x01")
            self.assertEqual(header[126:128], b"IM")
            # The published file must still be readable by scipy with the official options.
            data = sio.loadmat(str(path), squeeze_me=True, struct_as_record=False)["data"]
            self.assertEqual(len(data), 2)

    def test_a_one_record_split_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, self.assertRaisesRegex(
            ValueError, "GRAPH2PLAN_SPLIT_TOO_SMALL"
        ):
            write_split_mat(
                Path(temporary) / "data_train.mat",
                [build_sample(canonical_for(row_of_rooms(4)))],
            )

    def test_source_documents_are_never_modified(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            data_root = self.build(temporary)
            before = {
                path: path.read_bytes() for path in sorted(data_root.glob("*/building.json"))
            }
            build_corpus(data_root, Path(temporary) / "out", preview_limit=1)
            after = {
                path: path.read_bytes() for path in sorted(data_root.glob("*/building.json"))
            }
            self.assertEqual(before, after)


class CliTest(unittest.TestCase):
    def test_convert_command_writes_the_documented_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "building.json"
            source.write_text(json.dumps(row_of_rooms(4), ensure_ascii=False), encoding="utf-8")
            target = Path(temporary) / "Graph2Plan"
            result = subprocess.run(
                [sys.executable, "-m", "conversion_graph2plan.cli", "convert",
                 "--input", str(source), "--output", str(target)],
                capture_output=True, text=True, cwd=CONVERSION_ROOT, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), f"Graph2Plan: {target}")
            self.assertEqual(
                sorted(path.name for path in target.iterdir()),
                ["conversion.json", "graph2plan.json", "graph2plan.schema.json",
                 "mapping.json", "preview.png", "vocabulary.json"],
            )

    def test_convert_refuses_an_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "building.json"
            source.write_text(json.dumps(row_of_rooms(4), ensure_ascii=False), encoding="utf-8")
            target = Path(temporary) / "Graph2Plan"
            target.mkdir()
            result = subprocess.run(
                [sys.executable, "-m", "conversion_graph2plan.cli", "convert",
                 "--input", str(source), "--output", str(target)],
                capture_output=True, text=True, cwd=CONVERSION_ROOT, check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("Refusing to overwrite", result.stderr)


if __name__ == "__main__":
    unittest.main()
