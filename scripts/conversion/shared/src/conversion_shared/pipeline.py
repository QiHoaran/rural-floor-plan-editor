"""Corpus orchestration, deterministic serialization, and safe publication."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from .discovery import BuildingSource, discover_sources
from .records import CleanedBuilding, build_records
from .schemas import schema_documents, validate_json_schema


class CorpusBuildError(RuntimeError):
    """Raised when one or more source records cannot be cleaned."""


def stable_json_bytes(value: Any, *, pretty: bool = True) -> bytes:
    options: dict[str, Any] = {"ensure_ascii": False, "sort_keys": True}
    if pretty:
        options["indent"] = 2
    else:
        options["separators"] = (",", ":")
    return (json.dumps(value, **options) + "\n").encode("utf-8")


def _write_json(path: Path, value: Any, *, pretty: bool = True) -> str:
    encoded = stable_json_bytes(value, pretty=pretty)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest()


def _write_jsonl(path: Path, values: Iterable[Any]) -> str:
    encoded = b"".join(stable_json_bytes(value, pretty=False) for value in values)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest()


def _corpus_hash(sources: list[BuildingSource]) -> str:
    material = {
        "sources": [{"path": source.relative_path, "sha256": source.sha256} for source in sources],
        "rules": {
            "source": "*/draft/building.autosave.json",
            "repair": "near_axis_global_median_v1",
            "relation_inference": "host_wall_room_membership_v1",
            "explicit_relations_take_precedence": True,
            "max_short_axis_mm": 250,
            "min_aspect_ratio": 16,
            "grid_size": 256,
            "grid_padding": 8,
            "rounding": "half_up",
            "semantic_mapping": {
                "卧室": "bedroom",
                "客厅": "living_room",
                "厨房": "kitchen",
                "杂物间": "storage",
                "阳光房": "sunroom",
                "other": "unknown",
            },
            "public_schemas": schema_documents(),
        },
    }
    return hashlib.sha256(stable_json_bytes(material, pretty=False)).hexdigest()


def _counter(values: Iterable[Any]) -> dict[str, int]:
    return dict(sorted(Counter("null" if value is None else str(value) for value in values).items()))


def _numeric_range(values: Iterable[Any]) -> dict[str, int | float | None]:
    numeric = [value for value in values if isinstance(value, (int, float)) and not isinstance(value, bool)]
    return {"min": min(numeric), "max": max(numeric)} if numeric else {"min": None, "max": None}


def _quality_report(
    sources: list[BuildingSource], results: list[CleanedBuilding], corpus_hash: str
) -> dict[str, Any]:
    entity_counts = {key: 0 for key in ["vertices", "walls", "rooms", "wall_elements", "relations"]}
    semantics: Counter[str] = Counter()
    wall_types: Counter[str] = Counter()
    opening_types: Counter[str] = Counter()
    unknown_room_semantics: list[dict[str, Any]] = []
    for result in results:
        for key, value in result.metrics["counts"].items():
            entity_counts[key] += int(value)
        semantics.update(result.metrics["room_semantics"])
        wall_types.update(result.metrics["wall_type_counts"])
        opening_types.update(result.metrics["opening_type_counts"])
        unknown_room_semantics.extend(
            {
                "building_id": result.metrics["building_id"],
                "room_id": room["id"],
                "original_function_code": room["original_function_code"],
                "display_name": room["display_name"],
            }
            for room in result.canonical["rooms"]
            if room["semantic"] == "unknown"
        )
    pair_count = 0
    byte_equal_count = 0
    for source in sources:
        building_path = source.path.parent.parent / "building.json"
        if building_path.is_file():
            pair_count += 1
            byte_equal_count += building_path.read_bytes() == source.path.read_bytes()
    return {
        "schema_version": "rural-clean-quality/1.0.0",
        "corpus_hash": corpus_hash,
        "building_count": len(results),
        "entity_counts": entity_counts,
        "workflow_status_counts": _counter(result.metrics["workflow_status"] for result in results),
        "input_schema_version_counts": _counter(result.metrics["input_schema_version"] for result in results),
        "plan_form_counts": _counter(result.metrics["plan_form"] for result in results),
        "room_semantic_counts": dict(sorted(semantics.items())),
        "unknown_room_semantics": unknown_room_semantics,
        "explicit_outside_region_count": sum(
            len(result.canonical["outside_regions"]) for result in results
        ),
        "wall_type_counts": dict(sorted(wall_types.items())),
        "opening_type_counts": dict(sorted(opening_types.items())),
        "building_dimension_ranges_mm": {
            axis: _numeric_range(result.metrics["building_dimensions_mm"][axis] for result in results)
            for axis in ("width", "height")
        },
        "wall_dimension_ranges_mm": {
            "thickness": _numeric_range(value for result in results for value in result.metrics["wall_thicknesses_mm"]),
            "height": _numeric_range(value for result in results for value in result.metrics["wall_heights_mm"]),
        },
        "opening_dimension_ranges_mm": {
            "width": _numeric_range(value for result in results for value in result.metrics["opening_widths_mm"]),
            "height": _numeric_range(value for result in results for value in result.metrics["opening_heights_mm"]),
        },
        "grid_quantization": {
            "max_error_mm": max(result.metrics["grid_quantization_max_error_mm"] for result in results),
            "measurement": "euclidean distance after integer-grid round-trip",
        },
        "repairs": {
            "repaired_wall_count": sum(result.metrics["repaired_wall_count"] for result in results),
            "moved_vertex_count": sum(result.metrics["moved_vertex_count"] for result in results),
            "buildings_with_repairs": sum(result.metrics["repaired_wall_count"] > 0 for result in results),
            "inferred_relation_count": sum(result.metrics["inferred_relation_count"] for result in results),
            "normalized_opening_type_count": sum(
                result.metrics["normalized_opening_type_count"] for result in results
            ),
            "buildings_with_relation_repairs": sum(
                result.metrics["inferred_relation_count"] > 0 for result in results
            ),
            "source_area_mismatch_count": sum(
                result.metrics["source_area_mismatch_count"] for result in results
            ),
            "buildings_with_source_area_mismatch": sum(
                result.metrics["source_area_mismatch_count"] > 0 for result in results
            ),
            "maximum_single_axis_delta_mm": max(
                result.metrics["maximum_single_axis_delta_mm"] for result in results
            ),
        },
        "building_autosave_comparison": {
            "paired_building_json_count": pair_count,
            "byte_equal_count": byte_equal_count,
            "byte_different_count": pair_count - byte_equal_count,
        },
        "per_building": [
            {
                **{key: value for key, value in result.metrics.items() if key != "room_semantics"},
                "room_semantics": dict(sorted(result.metrics["room_semantics"].items())),
            }
            for result in results
        ],
    }


def _validate_written_tree(
    root: Path,
    sources: list[BuildingSource],
    results: list[CleanedBuilding],
    manifest: dict[str, Any],
    quality: dict[str, Any],
) -> None:
    schemas = schema_documents()
    written_schemas = {
        filename: json.loads((root / "schemas" / filename).read_text(encoding="utf-8"))
        for filename in schemas
    }
    if written_schemas != schemas:
        raise ValueError("Written public schemas do not match the runtime schemas")
    canonical_lines = [json.loads(line) for line in (root / "canonical.jsonl").read_text(encoding="utf-8").splitlines()]
    training_lines = [json.loads(line) for line in (root / "training.jsonl").read_text(encoding="utf-8").splitlines()]
    household_lines = [json.loads(line) for line in (root / "household/household.jsonl").read_text(encoding="utf-8").splitlines()]
    if canonical_lines != [result.canonical for result in results]:
        raise ValueError("canonical.jsonl does not match per-record data")
    if training_lines != [result.training for result in results]:
        raise ValueError("training.jsonl does not match per-record data")
    if household_lines != [result.household for result in results]:
        raise ValueError("household.jsonl does not match per-record data")
    if json.loads((root / "manifest.json").read_text(encoding="utf-8")) != manifest:
        raise ValueError("manifest.json failed round-trip validation")
    if json.loads((root / "quality_report.json").read_text(encoding="utf-8")) != quality:
        raise ValueError("quality_report.json failed round-trip validation")
    validate_json_schema(manifest, schemas["manifest.schema.json"])
    for source, result in zip(sources, results, strict=True):
        canonical_path = root / "canonical" / f"{source.building_id}.json"
        training_path = root / "training" / f"{source.building_id}.json"
        if json.loads(canonical_path.read_text(encoding="utf-8")) != result.canonical:
            raise ValueError(f"Canonical file differs for {source.building_id}")
        if json.loads(training_path.read_text(encoding="utf-8")) != result.training:
            raise ValueError(f"Training file differs for {source.building_id}")
        validate_json_schema(result.canonical, schemas["canonical.schema.json"])
        validate_json_schema(result.training, schemas["training.schema.json"])
        validate_json_schema(result.household, schemas["household.schema.json"])
        forbidden_training = {"gender", "age", "resident_count", "family_structure", "annual_income", "primary_income_source"}
        if forbidden_training & result.training.keys():
            raise ValueError(f"Training record leaks household fields for {source.building_id}")
        if {"building_id", "village_code", "household_code"} & result.household.keys():
            raise ValueError(f"Household record leaks direct identifiers for {source.building_id}")
    for mapping in manifest["records"]:
        for file_key, hash_key in (
            ("canonical_file", "canonical_sha256"),
            ("training_file", "training_sha256"),
        ):
            actual = hashlib.sha256((root / mapping[file_key]).read_bytes()).hexdigest()
            if actual != mapping[hash_key]:
                raise ValueError(f"Manifest hash mismatch for {mapping[file_key]}")


def _publish(staging: Path, output_root: Path, replace: bool) -> None:
    if not output_root.exists():
        os.replace(staging, output_root)
        return
    if not replace:
        raise FileExistsError(f"Output already exists: {output_root}")
    backup = output_root.with_name(f".{output_root.name}.backup")
    if backup.exists():
        raise FileExistsError(f"Refusing to overwrite existing backup: {backup}")
    os.replace(output_root, backup)
    try:
        os.replace(staging, output_root)
    except Exception:
        os.replace(backup, output_root)
        raise
    try:
        shutil.rmtree(backup)
    except OSError:
        # Publication has already succeeded. A leftover backup is recoverable
        # housekeeping and must not turn success into a false rollback report.
        pass


def _write_failure_report(
    output_root: Path,
    *,
    source_count: int,
    failures: list[dict[str, Any]],
) -> None:
    _write_json(
        output_root.with_name(f"{output_root.name}.failure.json"),
        {
            "schema_version": "rural-clean-failure/1.0.0",
            "source_count": source_count,
            "failed_count": len(failures),
            "failures": failures,
        },
    )


def clean_corpus(
    input_root: Path,
    output_root: Path,
    *,
    dry_run: bool = False,
    replace: bool = False,
) -> dict[str, Any]:
    """Clean all autosaves and atomically publish a deterministic corpus."""

    input_root = input_root.resolve()
    output_root = output_root.resolve()
    if (
        input_root == output_root
        or input_root in output_root.parents
        or output_root in input_root.parents
    ):
        raise ValueError("Input and output directories must be separate and must not contain one another")
    if output_root.exists() and not replace and not dry_run:
        raise FileExistsError(f"Output already exists: {output_root}")
    try:
        sources = discover_sources(input_root)
        if not sources:
            raise ValueError(f"No building autosaves found under {input_root}")
    except Exception as error:
        _write_failure_report(
            output_root,
            source_count=0,
            failures=[
                {
                    "stage": "discovery",
                    "error_type": type(error).__name__,
                    "message": str(error),
                }
            ],
        )
        raise CorpusBuildError("Source discovery failed; formal output was not published") from error
    results: list[CleanedBuilding] = []
    failures: list[dict[str, str]] = []
    for source in sources:
        try:
            results.append(build_records(source))
        except Exception as error:
            failures.append(
                {
                    "stage": "record_build",
                    "building_id": source.building_id,
                    "source": source.relative_path,
                    "error_type": type(error).__name__,
                    "message": str(error),
                }
            )
    if failures:
        _write_failure_report(output_root, source_count=len(sources), failures=failures)
        raise CorpusBuildError(f"{len(failures)} building(s) failed; formal output was not published")

    corpus_hash = _corpus_hash(sources)
    quality = _quality_report(sources, results, corpus_hash)
    summary = {
        "building_count": len(results),
        "corpus_hash": corpus_hash,
        "entity_counts": quality["entity_counts"],
        "repaired_wall_count": quality["repairs"]["repaired_wall_count"],
    }
    if dry_run:
        return summary

    output_root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output_root.name}.staging-", dir=output_root.parent))
    try:
        mappings: list[dict[str, Any]] = []
        for source, result in zip(sources, results, strict=True):
            canonical_file = f"canonical/{source.building_id}.json"
            training_file = f"training/{source.building_id}.json"
            canonical_sha = _write_json(staging / canonical_file, result.canonical)
            training_sha = _write_json(staging / training_file, result.training)
            mappings.append(
                {
                    "building_id": source.building_id,
                    "record_id": result.canonical["record_id"],
                    "source_relative_path": source.relative_path,
                    "source_sha256": source.sha256,
                    "canonical_file": canonical_file,
                    "canonical_sha256": canonical_sha,
                    "training_file": training_file,
                    "training_sha256": training_sha,
                }
            )
        _write_jsonl(staging / "canonical.jsonl", (result.canonical for result in results))
        _write_jsonl(staging / "training.jsonl", (result.training for result in results))
        _write_jsonl(staging / "household/household.jsonl", (result.household for result in results))
        for filename, schema in schema_documents().items():
            _write_json(staging / "schemas" / filename, schema)
        manifest = {
            "schema_version": "rural-clean-manifest/1.0.0",
            "corpus_hash": corpus_hash,
            "building_count": len(results),
            "source_pattern": "*/draft/building.autosave.json",
            "rules": {
                "repair": {"version": "near_axis_global_median_v1", "max_short_axis_mm": 250, "min_aspect_ratio": 16},
                "relation_inference": {
                    "version": "host_wall_room_membership_v1",
                    "explicit_relations_take_precedence": True,
                },
                "grid": {"size": 256, "padding": 8, "rounding": "half_up", "north_is_positive_y": True},
                "semantic_vocabulary": ["bedroom", "kitchen", "living_room", "storage", "sunroom", "unknown"],
            },
            "records": mappings,
        }
        _write_json(staging / "manifest.json", manifest)
        _write_json(staging / "quality_report.json", quality)
        _validate_written_tree(staging, sources, results, manifest, quality)
        _publish(staging, output_root, replace)
    except Exception as error:
        if staging.exists():
            shutil.rmtree(staging)
        _write_failure_report(
            output_root,
            source_count=len(sources),
            failures=[
                {
                    "stage": "write_validate_publish",
                    "error_type": type(error).__name__,
                    "message": str(error),
                }
            ],
        )
        raise CorpusBuildError("Output staging or publication failed; formal output was not updated") from error
    failure_path = output_root.with_name(f"{output_root.name}.failure.json")
    if failure_path.exists():
        try:
            failure_path.unlink()
        except OSError:
            pass
    return summary
