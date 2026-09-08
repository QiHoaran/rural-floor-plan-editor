"""Single-building conversion worker. JSON-lines stdout is reserved for result events."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sys
from contextlib import redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


@dataclass(frozen=True)
class Converter:
    id: str
    name: str
    directory: str
    version: str
    modules: tuple[str, ...]
    execute: Callable[["Context", Path], dict[str, Any]]
    needs_cleaned: bool = False

    def availability(self) -> dict[str, Any]:
        try:
            if sys.version_info < (3, 13):
                raise RuntimeError("Python 3.13+ is required")
            for module in self.modules:
                with redirect_stdout(sys.stderr):
                    importlib.import_module(module)
            return {"available": True}
        except Exception as exc:
            return {"available": False, "message": f"Conversion environment unavailable: {exc}. Run uv sync --all-packages --all-groups --locked in scripts/conversion."}


@dataclass
class Context:
    request: dict[str, Any]
    document: dict[str, Any]
    cleaned: Any = None


def graph(context: Context, output: Path) -> dict[str, Any]:
    from conversion_graph.graph import (
        _validate_graph_integrity,
        build_graph_record,
        graph_schema_document,
    )
    from conversion_shared.schemas import validate_json_schema
    from conversion_shared.vocabulary import multimodal_vocabulary
    value = build_graph_record(context.cleaned.canonical, context.cleaned.training)
    schema = graph_schema_document()
    validate_json_schema(value, schema)
    _validate_graph_integrity(value)
    output.mkdir()
    write_json(output / "graph.json", value)
    write_json(output / "graph.schema.json", schema)
    write_json(output / "vocabulary.json", multimodal_vocabulary())
    return {"grid_size": 256}


def image(context: Context, output: Path) -> dict[str, Any]:
    from conversion_image.image import (
        _histogram,
        _validate_image_integrity,
        image_schema_document,
        render_training_masks,
    )
    from conversion_shared.schemas import validate_json_schema
    from conversion_shared.vocabulary import multimodal_vocabulary
    from PIL import Image
    rendered = render_training_masks(context.cleaned.training)
    schema = image_schema_document()
    validate_json_schema(rendered.stats, schema)
    _validate_image_integrity(rendered)
    output.mkdir()
    for name, mask in (("semantic", rendered.semantic), ("instance", rendered.instance)):
        path = output / f"{name}.png"
        mask.save(path, format="PNG", optimize=False, compress_level=9)
        with Image.open(path) as loaded:
            if loaded.size != (256, 256) or _histogram(loaded) != rendered.stats[f"{name}_histogram"]:
                raise ValueError("IMAGE_ROUNDTRIP_MISMATCH")
            if name == "instance" and path.read_bytes()[24] != 16:
                raise ValueError("INSTANCE_BIT_DEPTH_MISMATCH")
    write_json(output / "stats.json", rendered.stats)
    write_json(output / "image.schema.json", schema)
    write_json(output / "vocabulary.json", multimodal_vocabulary())
    return {"grid_size": 256, "instance_bit_depth": 16, "compress_level": 9}


def cad(context: Context, output: Path) -> dict[str, Any]:
    from conversion_cad.cad import (
        _validate_cad_integrity,
        build_cad_primitives,
        cad_schema_document,
        write_dxf,
    )
    from conversion_shared.schemas import validate_json_schema
    from conversion_shared.vocabulary import multimodal_vocabulary
    value = build_cad_primitives(context.cleaned.canonical)
    schema = cad_schema_document()
    validate_json_schema(value, schema)
    _validate_cad_integrity(value)
    output.mkdir()
    write_json(output / "primitives.json", value)
    write_json(output / "cad.schema.json", schema)
    write_json(output / "vocabulary.json", multimodal_vocabulary())
    write_dxf(value, output / "building.dxf")
    return {"units": "millimeters", "dxf_version": "AC1024"}


class Quarantined(Exception):
    pass


def embodied(context: Context, output: Path) -> dict[str, Any]:
    from embodied.config import Config
    from embodied.pipeline import build_artifacts
    config = Config()
    report = build_artifacts(context.document, output, config)
    if report.get("status") == "quarantined":
        if report.get("reason_code") in {
            "TOKEN_GRAMMAR_ERROR", "FLOORPLAN_ROUNDTRIP_MISMATCH", "NON_DETERMINISTIC_REENCODE",
        }:
            raise ValueError(report["reason"])
        raise Quarantined(report["reason"])
    if not report.get("roundtrip_exact"):
        raise ValueError("FLOORPLAN_ROUNDTRIP_MISMATCH: validation did not confirm exactness")
    if len(list(output.glob("*.json"))) != 10:
        raise ValueError("EMBODIED_ARTIFACT_COUNT_MISMATCH")
    return config.model_dump(mode="json")


# Add a converter here; task execution and the JSON-lines protocol remain unchanged.
REGISTRY = {item.id: item for item in (
    Converter("graph", "Graph", "Graph", "1.0.0", ("conversion_graph.graph",), graph, True),
    Converter("image", "Image", "Image", "1.0.0", ("conversion_image.image",), image, True),
    Converter("cad", "CAD", "CAD", "1.0.0", ("conversion_cad.cad", "ezdxf"), cad, True),
    Converter("embodied", "Embodied", "Embodied", "1.0.0", ("embodied.pipeline",), embodied),
)}


def convert(request: dict[str, Any], emit: Callable[[dict[str, Any]], None]) -> None:
    source = Path(request["source_path"])
    output = Path(request["output_dir"])
    if not source.is_absolute() or not output.is_absolute() or not output.is_dir():
        raise ValueError("Source and existing staging directory must be absolute paths")
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != request["source_sha256"]:
        raise ValueError("SOURCE_HASH_MISMATCH")
    document = json.loads(raw)
    if not isinstance(document, dict):
        raise ValueError("Building must be an object")
    if document.get("metadata", {}).get("revision") != request["source_revision"]:
        raise ValueError("SOURCE_REVISION_MISMATCH")
    if document.get("workflow", {}).get("status") != "complete":
        raise ValueError("SOURCE_NOT_COMPLETE")
    formats = request["formats"]
    if not isinstance(formats, list) or not formats or any(item not in REGISTRY for item in formats) or len(set(formats)) != len(formats):
        raise ValueError("Unknown, empty or duplicate formats")
    context = Context(request, document)
    preprocessing_error = None
    if any(REGISTRY[item].needs_cleaned for item in formats):
        try:
            from conversion_shared.discovery import BuildingSource
            from conversion_shared.records import build_records
            context.cleaned = build_records(BuildingSource(document["building_id"], source, f"{document['building_id']}/building.json", request["source_sha256"], document))
        except Exception as exc:
            preprocessing_error = exc
    for format_id in formats:
        converter = REGISTRY[format_id]
        target = output / converter.directory
        try:
            if target.exists() or target.is_symlink():
                raise FileExistsError(f"Refusing to overwrite {target}")
            availability = converter.availability()
            if not availability["available"]:
                raise RuntimeError(availability["message"])
            if converter.needs_cleaned and preprocessing_error:
                raise RuntimeError(f"PREPROCESS_FAILED: {preprocessing_error}") from preprocessing_error
            with redirect_stdout(sys.stderr):
                config = converter.execute(context, target)
            write_json(target / "conversion.json", {
                "schema_version": "building-conversion/1.0.0", "building_id": document["building_id"],
                "source_revision": request["source_revision"], "source_sha256": request["source_sha256"],
                "format": format_id, "converter_version": converter.version, "config": config,
                "repairs": context.cleaned.canonical["repairs"] if converter.needs_cleaned else {},
                "artifacts": [{"path": path.relative_to(target).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(target.rglob("*")) if path.is_file()],
            })
            emit({"format": format_id, "status": "succeeded", "output_dir": str(target)})
        except Quarantined as exc:
            emit({"format": format_id, "status": "quarantined", "message": str(exc), "output_dir": str(target)})
        except Exception as exc:
            emit({"format": format_id, "status": "failed", "message": f"{type(exc).__name__}: {exc}"})


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--request", type=Path)
    args = parser.parse_args()
    def emit(value: dict[str, Any]) -> None:
        print(json.dumps(value, ensure_ascii=True), flush=True)
    if args.check:
        formats = [{"id": c.id, "name": c.name, "directory": c.directory, "version": c.version, **c.availability()} for c in REGISTRY.values()]
        available = all(item["available"] for item in formats)
        emit({"available": available, "formats": formats})
        return 0 if available else 1
    try:
        convert(json.loads(args.request.read_text(encoding="utf-8-sig")), emit)
        return 0
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
