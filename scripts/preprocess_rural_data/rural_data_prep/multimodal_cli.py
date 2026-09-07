"""Command-line adapters for the three model-ready converters."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Literal, Sequence

from .multimodal import convert_modality


def _parser(modality: str, entry_path: Path) -> argparse.ArgumentParser:
    repository_root = entry_path.resolve().parents[2]
    parser = argparse.ArgumentParser(
        prog=entry_path.name,
        description=f"Convert cleaned rural floor plans to {modality} training data.",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=repository_root / "data" / "rural_data" / "cleaned",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repository_root / "data" / "rural_data" / "model_ready" / modality,
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(
    modality: Literal["graph", "image", "cad"],
    entry_path: Path,
    argv: Sequence[str] | None = None,
) -> int:
    """Run one converter and emit exactly one machine-readable result."""

    arguments = _parser(modality, entry_path).parse_args(argv)
    try:
        summary = convert_modality(
            modality,
            arguments.input,
            arguments.output,
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
