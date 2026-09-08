"""Batch CLI for cleaned → Image training data."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from conversion_shared.convert import convert_modality
from conversion_shared.paths import find_repository_root


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="conversion-image",
        description="Convert cleaned rural floor plans to image training data.",
    )
    parser.add_argument("--input", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the image converter and emit exactly one machine-readable result."""

    arguments = _parser().parse_args(argv)
    input_root = arguments.input
    output_root = arguments.output
    if input_root is None or output_root is None:
        repository_root = find_repository_root()
        input_root = input_root or (repository_root / "data" / "rural_data" / "cleaned")
        output_root = output_root or (
            repository_root / "data" / "rural_data" / "model_ready" / "image"
        )
    try:
        summary = convert_modality(
            "image",
            input_root,
            output_root,
            force=arguments.force,
            dry_run=arguments.dry_run,
        )
    except Exception as error:
        print(
            json.dumps(
                {"error": {"type": type(error).__name__, "message": str(error)}},
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(summary.as_dict(), ensure_ascii=False, sort_keys=True))
    return 0
