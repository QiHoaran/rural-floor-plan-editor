from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class EmbodiedCliTest(unittest.TestCase):
    def test_extensionless_entrypoint_builds_corpus_from_another_working_directory(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        entrypoint = project_root / "04_Json_to_embodied.py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "cleaned"
            output_root = root / "embodied"
            source_root = project_root.parents[1] / "data" / "rural_data" / "cleaned"
            if not (source_root / "manifest.json").exists():
                self.skipTest("External cleaned corpus is not installed")
            source_manifest = json.loads(
                (source_root / "manifest.json").read_text(encoding="utf-8")
            )
            record = source_manifest["records"][0]
            canonical_relative = Path(record["canonical_file"])
            (input_root / canonical_relative).parent.mkdir(parents=True)
            shutil.copyfile(
                source_root / canonical_relative,
                input_root / canonical_relative,
            )
            manifest = {
                **source_manifest,
                "building_count": 1,
                "records": [record],
            }
            input_root.mkdir(exist_ok=True)
            (input_root / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
            )
            shutil.copyfile(
                source_root / "quality_report.json",
                input_root / "quality_report.json",
            )
            output_root.mkdir()
            (output_root / "stale.txt").write_text("replace me", encoding="utf-8")
            config_path = (
                project_root / "rural-embodied-plan" / "examples" / "sample_config.yaml"
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(entrypoint),
                    "--input",
                    str(input_root),
                    "--output",
                    str(output_root),
                    "--config",
                    str(config_path),
                    "--force",
                ],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            summary = json.loads(completed.stdout)
            self.assertEqual(summary["valid_building_count"], 1)
            self.assertEqual(summary["excluded_building_count"], 0)
            self.assertEqual(summary["artifact_count"], 6)
            self.assertFalse((output_root / "stale.txt").exists())
            self.assertEqual(
                len(list((output_root / record["building_id"]).glob("*.json"))),
                6,
            )


if __name__ == "__main__":
    unittest.main()
