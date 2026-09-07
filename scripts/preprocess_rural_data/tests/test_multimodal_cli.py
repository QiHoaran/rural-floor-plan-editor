from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:
    from rural_data_prep.multimodal_cli import main
except ImportError:
    main = None

from tests.test_multimodal_pipeline import write_cleaned_fixture


class MultimodalCliTest(unittest.TestCase):
    def test_dry_run_prints_machine_readable_summary(self) -> None:
        """Catches CLI adapters that use wrong paths or emit non-JSON success output."""

        self.assertIsNotNone(main, "multimodal CLI is missing")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "cleaned"
            output_root = root / "graph"
            write_cleaned_fixture(input_root)
            stdout = io.StringIO()

            with contextlib.redirect_stdout(stdout):
                exit_code = main(
                    "graph",
                    Path(__file__),
                    ["--input", str(input_root), "--output", str(output_root), "--dry-run"],
                )

            summary = json.loads(stdout.getvalue())
            self.assertEqual(exit_code, 0)
            self.assertEqual(summary["modality"], "graph")
            self.assertEqual(summary["record_count"], 1)
            self.assertTrue(summary["dry_run"])
            self.assertFalse(output_root.exists())

    def test_failure_prints_structured_error_and_returns_two(self) -> None:
        """Catches raw tracebacks or success exit codes for invalid input roots."""

        self.assertIsNotNone(main, "multimodal CLI is missing")
        stderr = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with contextlib.redirect_stderr(stderr):
                exit_code = main(
                    "image",
                    Path(__file__),
                    ["--input", str(root / "missing"), "--output", str(root / "image")],
                )

        error = json.loads(stderr.getvalue())
        self.assertEqual(exit_code, 2)
        self.assertEqual(error["error"]["type"], "FileNotFoundError")
        self.assertIn("manifest.json", error["error"]["message"])

    def test_extensionless_graph_entrypoint_executes_from_another_working_directory(self) -> None:
        """Catches entrypoints that depend on the caller's current directory or are empty."""

        project_root = Path(__file__).resolve().parents[1]
        entrypoint = project_root / "01_Json_to_Graph.py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "cleaned"
            output_root = root / "graph"
            write_cleaned_fixture(input_root)

            completed = subprocess.run(
                [
                    sys.executable,
                    str(entrypoint),
                    "--input",
                    str(input_root),
                    "--output",
                    str(output_root),
                    "--dry-run",
                ],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue(completed.stdout, "entrypoint produced no JSON summary")
            self.assertEqual(json.loads(completed.stdout)["modality"], "graph")
            self.assertFalse(output_root.exists())


if __name__ == "__main__":
    unittest.main()
