from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from conversion_shared.convert import convert_modality


def tree_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


@unittest.skipUnless(os.environ.get("RURAL_FULL_CORPUS") == "1", "full corpus opt-in")
class FullMultimodalCorpusDeterminismTest(unittest.TestCase):
    def test_all_modalities_are_aligned_and_byte_deterministic(self) -> None:
        """Catches corpus-only category drift, count loss, or nondeterministic artifacts."""

        default_root = Path(__file__).resolve().parents[3] / "data" / "rural_data" / "cleaned"
        input_root = Path(os.environ.get("RURAL_CLEANED_ROOT", default_root))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifests: dict[str, dict[str, object]] = {}
            for modality, expected_files in (("graph", 469), ("image", 1398), ("cad", 934)):
                first = root / "first" / modality
                second = root / "second" / modality
                convert_modality(modality, input_root, first)
                convert_modality(modality, input_root, second)
                self.assertEqual(len(tree_hashes(first)), expected_files)
                self.assertEqual(tree_hashes(first), tree_hashes(second))
                manifests[modality] = json.loads(
                    (first / "manifest.json").read_text(encoding="utf-8")
                )

            record_ids = {
                modality: [record["record_id"] for record in manifest["records"]]
                for modality, manifest in manifests.items()
            }
            self.assertEqual(record_ids["graph"], record_ids["image"])
            self.assertEqual(record_ids["graph"], record_ids["cad"])
            self.assertEqual(len(record_ids["graph"]), 465)
            graphs = [
                json.loads(line)
                for line in (root / "first" / "graph" / "graphs.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            self.assertEqual(sum(graph["counts"]["rooms"] for graph in graphs), 1937)
            self.assertEqual(sum(graph["counts"]["nodes"] for graph in graphs), 2402)
            self.assertEqual(sum(graph["counts"]["edges"] for graph in graphs), 4277)


if __name__ == "__main__":
    unittest.main()
