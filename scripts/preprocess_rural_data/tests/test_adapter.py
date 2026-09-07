from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "rural-embodied-plan" / "tests"))
import adapter
from v2_fixtures import raw_rectangle
from rural_data_prep.records import build_records
from rural_data_prep.discovery import BuildingSource
from rural_data_prep.multimodal import build_graph_record, build_cad_primitives, render_training_masks
from rural_embodied_plan.v2.config import V2Config
from rural_embodied_plan.v2.pipeline import build_v2_artifacts


class AdapterTests(unittest.TestCase):
    def test_dxf_is_deterministic_across_process_hash_seeds(self):
        request = self.request(["cad"])
        results = []
        for seed in (1, 4):
            output = self.root / f"seed-{seed}"
            output.mkdir()
            request_path = self.root / f"request-{seed}.json"
            request_path.write_text(json.dumps(dict(request, output_dir=str(output))), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(Path(adapter.__file__)), "--request", str(request_path)],
                env={**os.environ, "PYTHONHASHSEED": str(seed)},
                capture_output=True, text=True, check=True,
            )
            self.assertEqual(json.loads(result.stdout)["status"], "succeeded", result.stdout)
            results.append((output / "CAD" / "building.dxf").read_bytes())
        self.assertEqual(results[0], results[1])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "中文 output"
        self.root.mkdir()
        self.document = raw_rectangle()
        self.document.update(metadata={"revision": 7}, workflow={"status": "complete"})

    def request(self, formats=None):
        self.source = self.root / "building.json"
        self.source.write_text(json.dumps(self.document), encoding="utf-8")
        return {"source_path": str(self.source), "output_dir": str(self.root),
                "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
                "source_revision": 7, "formats": formats or list(adapter.REGISTRY)}

    def test_all_formats_match_reference_and_source_unchanged(self):
        request = self.request()
        original = self.source.read_bytes()
        events = []
        with patch("rural_data_prep.records.build_records", wraps=build_records) as records:
            adapter.convert(request, events.append)
        self.assertEqual(records.call_count, 1)
        self.assertEqual([e["status"] for e in events], ["succeeded"] * 4, events)
        cleaned = build_records(BuildingSource("test", self.source, "test/building.json", request["source_sha256"], self.document))
        read = lambda name: json.loads((self.root / name).read_text(encoding="utf-8"))
        self.assertEqual(read("Graph/graph.json"), build_graph_record(cleaned.canonical, cleaned.training))
        self.assertEqual(read("CAD/primitives.json"), build_cad_primitives(cleaned.canonical))
        import ezdxf
        dxf = ezdxf.readfile(self.root / "CAD/building.dxf")
        self.assertEqual(dxf.units, ezdxf.units.MM)
        primitives = read("CAD/primitives.json")
        self.assertEqual({e.dxf.layer for e in dxf.modelspace()}, {p["layer"] for group in ("boundaries", "rooms", "walls", "openings") for p in primitives[group]})
        self.assertEqual(read("Image/stats.json"), render_training_masks(cleaned.training).stats)
        reference = self.root / "reference"
        build_v2_artifacts(self.document, reference, V2Config())
        for file in reference.iterdir():
            self.assertEqual(file.read_bytes(), (self.root / "Embodied" / file.name).read_bytes())
        for directory in ("Graph", "Image", "CAD", "Embodied"):
            metadata = read(f"{directory}/conversion.json")
            self.assertEqual(metadata["source_revision"], 7)
            for artifact in metadata["artifacts"]:
                self.assertEqual(hashlib.sha256((self.root / directory / artifact["path"]).read_bytes()).hexdigest(), artifact["sha256"])
        self.assertEqual(original, self.source.read_bytes())

    def test_deterministic_outputs(self):
        request = self.request()
        adapter.convert(request, lambda _: None)
        second = self.root / "second"
        second.mkdir()
        adapter.convert(dict(request, output_dir=str(second)), lambda _: None)
        for converter in adapter.REGISTRY.values():
            for file in (self.root / converter.directory).iterdir():
                self.assertEqual(file.read_bytes(), (second / converter.directory / file.name).read_bytes(), file.name)

    def test_quarantine_is_distinct_from_programming_errors(self):
        self.document["faces"]["room"]["holes"] = [[1, 2, 3]]
        events = []
        adapter.convert(self.request(["embodied_v2", "graph"]), events.append)
        self.assertEqual([e["status"] for e in events], ["quarantined", "succeeded"])
        self.assertEqual([p.name for p in (self.root / "Embodied").iterdir()], ["quarantine_report.json"])
        (self.root / "Embodied" / "quarantine_report.json").unlink()
        (self.root / "Embodied").rmdir()
        events = []
        with patch("rural_embodied_plan.v2.pipeline.build_v2_artifacts", side_effect=ValueError("unclassified codec bug")):
            adapter.convert(self.request(["embodied_v2"]), events.append)
        self.assertEqual(events[0]["status"], "failed")

    def test_codec_invariants_are_failures_even_if_reference_quarantines_them(self):
        for code in ("TOKEN_GRAMMAR_ERROR", "FLOORPLAN_ROUNDTRIP_MISMATCH", "NON_DETERMINISTIC_REENCODE"):
            events = []
            with patch("rural_embodied_plan.v2.pipeline.build_v2_artifacts", return_value={"status": "quarantined", "reason_code": code, "reason": f"{code}: test"}):
                adapter.convert(self.request(["embodied_v2"]), events.append)
            self.assertEqual(events[0]["status"], "failed")
            self.assertIn(code, events[0]["message"])

    def test_hash_revision_status_and_existing_directory_guards(self):
        request = self.request(["graph"])
        for key, value in (("source_sha256", "wrong"), ("source_revision", 8)):
            with self.assertRaises(ValueError):
                adapter.convert(dict(request, **{key: value}), lambda _: None)
        self.document["workflow"]["status"] = "draft"
        with self.assertRaisesRegex(ValueError, "SOURCE_NOT_COMPLETE"):
            adapter.convert(self.request(["graph"]), lambda _: None)
        self.document["workflow"]["status"] = "complete"
        (self.root / "Graph").mkdir()
        sentinel = self.root / "Graph" / "keep"
        sentinel.write_text("untouched")
        events = []
        adapter.convert(self.request(["graph"]), events.append)
        self.assertEqual(events[0]["status"], "failed")
        self.assertEqual(sentinel.read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()
