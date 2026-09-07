"""Command-line adapter for cleaned-to-Embodied corpus generation."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from rural_embodied_plan.config import default_config_path
from rural_embodied_plan.corpus import build_corpus


def _parser(entry_path: Path) -> argparse.ArgumentParser:
    repository_root = entry_path.resolve().parents[2]
    parser = argparse.ArgumentParser(
        prog=entry_path.name,
        description="Convert cleaned rural floor plans to Embodied training data.",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=repository_root / "data" / "rural_data" / "cleaned",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repository_root / "data" / "rural_data" / "model_ready" / "embodied",
    )
    parser.add_argument("--config", type=Path, default=default_config_path())
    parser.add_argument("--force", action="store_true")
    return parser


def main(entry_path: Path, argv: Sequence[str] | None = None) -> int:
    """Build the complete Embodied corpus and emit one JSON result."""

    arguments = _parser(entry_path).parse_args(argv)
    try:
        summary = build_corpus(
            arguments.input,
            arguments.output,
            config_path=arguments.config,
            replace=arguments.force,
        )
    except Exception as error:  # noqa: BLE001 - CLI converts failures to structured JSON.
        print(
            json.dumps(
                {"error": {"type": type(error).__name__, "message": str(error)}},
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0
