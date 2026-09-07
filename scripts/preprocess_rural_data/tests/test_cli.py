from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from rural_data_prep.cli import main
from tests.test_pipeline import write_source
from tests.test_records import sample_document


class CliTest(unittest.TestCase):
    def test_clean_dry_run_prints_machine_readable_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            write_source(input_root, sample_document())
            stdout = io.StringIO()

            with contextlib.redirect_stdout(stdout):
                exit_code = main(
                    ["clean", "--input", str(input_root), "--output", str(output_root), "--dry-run"]
                )

            self.assertEqual(exit_code, 0)
            self.assertEqual(json.loads(stdout.getvalue())["building_count"], 1)
            self.assertFalse(output_root.exists())

    def test_clean_returns_nonzero_and_prints_error_for_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            output_root = root / "cleaned"
            write_source(input_root, sample_document())
            output_root.mkdir()
            stderr = io.StringIO()

            with contextlib.redirect_stderr(stderr):
                exit_code = main(["clean", "--input", str(input_root), "--output", str(output_root)])

            self.assertEqual(exit_code, 2)
            self.assertIn("Output already exists", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
