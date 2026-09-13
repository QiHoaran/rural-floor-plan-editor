"""Command-line entry points for the Graph2Plan conversion."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

from conversion_shared.discovery import BuildingSource
from conversion_shared.io import _write_json
from conversion_shared.records import build_records

from .corpus import build_corpus, deterministic_digest
from .graph2plan import (
    build_sample,
    mapping_document,
    mat_record,
    record_schema_document,
    validate_record,
)
from .preview import render_preview
from .vocabulary import vocabulary


def _convert_one(args: argparse.Namespace) -> int:
    source, output = args.input.resolve(), args.output.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError(f"Refusing to overwrite {output}")
    raw = source.read_bytes()
    document = json.loads(raw)
    if document.get("workflow", {}).get("status") != "complete":
        raise ValueError("SOURCE_NOT_COMPLETE")
    digest = hashlib.sha256(raw).hexdigest()
    building_id = document["building_id"]
    cleaned = build_records(
        BuildingSource(building_id, source, f"{building_id}/building.json", digest, document)
    )
    sample = build_sample(cleaned.canonical)
    record = mat_record(sample)
    validate_record(record)

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".graph2plan-", dir=output.parent) as temporary:
        stage = Path(temporary) / "Graph2Plan"
        stage.mkdir()
        _write_json(
            stage / "graph2plan.json",
            {"schema_version": "graph2plan-record/1.0.0", "building_id": building_id, "record": record},
        )
        _write_json(stage / "mapping.json", mapping_document(sample))
        _write_json(stage / "vocabulary.json", vocabulary())
        _write_json(stage / "graph2plan.schema.json", record_schema_document())
        if not args.no_preview:
            render_preview(sample).save(stage / "preview.png")
        _write_json(
            stage / "conversion.json",
            {
                "schema_version": "building-conversion/1.0.0",
                "building_id": building_id,
                "source_revision": document.get("metadata", {}).get("revision"),
                "source_sha256": digest,
                "format": "graph2plan",
                "converter_version": "1.0.0",
                "config": {"grid_size": 256, "padding": 8, "edge_source": "door-mediated room adjacency"},
                "repairs": cleaned.canonical["repairs"],
                "artifacts": [
                    {"path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    for path in sorted(stage.iterdir())
                ],
            },
        )
        if output.exists() or output.is_symlink():
            raise ValueError(f"Refusing to overwrite {output}")
        stage.rename(output)
    for line in _summary(sample):
        print(line, file=sys.stderr)
    print(f"Graph2Plan: {output}")
    return 0


def _summary(sample) -> list[str]:
    lines = [
        f"rooms: {len(sample.rooms)}  boundary vertices: {len(sample.boundary)}",
        f"door edges: {len(sample.edges)}  bbox-only (upstream): {len(sample.comparison['bbox_only'])}",
        (
            f"front door: {sample.chosen_entrance.element_id} "
            f"(room {sample.chosen_entrance.face_id}, {sample.chosen_entrance.face_semantic})"
        ),
        f"other entrances: {len(sample.entrances) - 1}",
        f"rType: {[room['label_name'] for room in sample.rooms]}",
        f"order (1-based): {sample.order}",
    ]
    lines.extend(f"warning: {warning}" for warning in sample.warnings)
    return lines


def _run_corpus(args: argparse.Namespace) -> int:
    manifest = build_corpus(
        args.input_root,
        args.output_root,
        progress=lambda message: print(message, file=sys.stderr),
        preview_limit=args.preview_limit,
        profile=args.profile,
    )
    print(json.dumps({key: manifest[key] for key in ("building_count", "sample_count", "excluded_count", "splits")}, ensure_ascii=False))
    if args.print_digest:
        print(f"digest: {deterministic_digest(args.output_root)}", file=sys.stderr)
    return 0


def _run_verify(args: argparse.Namespace) -> int:
    from .official_loader import verify_dataset

    report = verify_dataset(args.graph2plan_root, args.dataset_dir, limit=args.limit)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["ok"] else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    one = subparsers.add_parser("convert", help="Convert one completed building.json")
    one.add_argument("--input", required=True, type=Path)
    one.add_argument("--output", required=True, type=Path)
    one.add_argument("--no-preview", action="store_true", help="Skip the QA render")
    one.set_defaults(handler=_convert_one)

    corpus = subparsers.add_parser("corpus", help="Convert a corpus and publish .mat splits")
    corpus.add_argument("--input-root", required=True, type=Path)
    corpus.add_argument("--output-root", required=True, type=Path)
    corpus.add_argument("--preview-limit", type=int, default=6)
    corpus.add_argument("--print-digest", action="store_true")
    corpus.add_argument("--profile", choices=("official", "rural-multi"), default="official")
    corpus.set_defaults(handler=_run_corpus)

    verify = subparsers.add_parser(
        "verify", help="Load the published splits with Graph2Plan's own FloorPlanDataset"
    )
    verify.add_argument("--graph2plan-root", required=True, type=Path)
    verify.add_argument("--dataset-dir", required=True, type=Path)
    verify.add_argument("--limit", type=int, default=None)
    verify.set_defaults(handler=_run_verify)

    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
