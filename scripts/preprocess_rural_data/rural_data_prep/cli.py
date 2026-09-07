"""Command-line interface for deterministic rural building preprocessing."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from .pipeline import CorpusBuildError, clean_corpus


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rural-data-prep")
    subparsers = parser.add_subparsers(dest="command", required=True)
    clean = subparsers.add_parser("clean", help="clean every discovered building autosave")
    clean.add_argument("--input", required=True, type=Path, help="root containing building directories")
    clean.add_argument("--output", required=True, type=Path, help="directory to publish cleaned artifacts")
    clean.add_argument("--dry-run", action="store_true", help="validate and summarize without writing output")
    clean.add_argument("--replace", action="store_true", help="atomically replace an existing output directory")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        summary = clean_corpus(
            args.input,
            args.output,
            dry_run=args.dry_run,
            replace=args.replace,
        )
    except (CorpusBuildError, FileExistsError, OSError, ValueError) as error:
        print(f"rural-data-prep: {error}", file=sys.stderr)
        return 2
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0

