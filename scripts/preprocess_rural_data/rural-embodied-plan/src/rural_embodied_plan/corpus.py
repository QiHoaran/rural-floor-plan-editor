"""All-or-nothing Embodied corpus generation from cleaned canonical records."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

from rural_embodied_plan.config import default_config_path, load_config
from rural_embodied_plan.io.canonical_loader import load_canonical
from rural_embodied_plan.io.json_writer import write_json
from rural_embodied_plan.pipeline import build_pipeline_artifacts

BUILDING_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


class CorpusBuildError(RuntimeError):
    """Raised when a cleaned corpus cannot be published in full."""


def _load_json(path: Path) -> Any:
    if not path.is_file():
        raise CorpusBuildError(f"Required cleaned file is missing: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CorpusBuildError(f"Invalid JSON at {path}: {exc}") from exc


def _canonical_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise CorpusBuildError(f"Canonical path escapes cleaned root: {relative}") from exc
    return path


def _publish(staging: Path, output_root: Path, replace: bool) -> None:
    if output_root.exists() and not replace:
        raise CorpusBuildError(f"Output already exists: {output_root}; pass --replace to rebuild")
    if not output_root.exists():
        os.replace(staging, output_root)
        return
    backup = output_root.with_name(f".{output_root.name}.previous")
    if backup.exists():
        raise CorpusBuildError(f"Atomic replacement backup already exists: {backup}")
    os.replace(output_root, backup)
    try:
        os.replace(staging, output_root)
    except Exception:
        os.replace(backup, output_root)
        raise
    shutil.rmtree(backup)


def build_corpus(
    input_root: Path,
    output_root: Path,
    *,
    config_path: Path | None = None,
    replace: bool = False,
) -> dict[str, Any]:
    """Verify every canonical hash, build every record, then publish atomically."""

    output_root = output_root.resolve()
    output_root.parent.mkdir(parents=True, exist_ok=True)
    failure_path = output_root.with_name(f"{output_root.name}.failure.json")
    staging = Path(
        tempfile.mkdtemp(prefix=f".{output_root.name}.staging-", dir=output_root.parent)
    )
    try:
        manifest = _load_json(input_root / "manifest.json")
        quality = _load_json(input_root / "quality_report.json")
        if manifest.get("schema_version") != "rural-clean-manifest/1.0.0":
            raise CorpusBuildError("Unsupported cleaned manifest schema")
        records = manifest.get("records")
        if not isinstance(records, list) or manifest.get("building_count") != len(records):
            raise CorpusBuildError("Cleaned manifest building_count does not match records")
        settings = load_config(config_path or default_config_path())
        seen: set[str] = set()
        aggregate_statistics: dict[str, int] = {}
        for record in records:
            building_id = record.get("building_id")
            if not isinstance(building_id, str) or not BUILDING_ID.fullmatch(building_id):
                raise CorpusBuildError(f"Unsafe building_id in cleaned manifest: {building_id!r}")
            if building_id in seen:
                raise CorpusBuildError(f"Duplicate building_id in cleaned manifest: {building_id}")
            seen.add(building_id)
            canonical_path = _canonical_path(input_root, record.get("canonical_file", ""))
            encoded = canonical_path.read_bytes()
            actual_sha = hashlib.sha256(encoded).hexdigest()
            if actual_sha != record.get("canonical_sha256"):
                raise CorpusBuildError(
                    f"Canonical SHA-256 mismatch for {building_id}: {actual_sha}"
                )
            document = load_canonical(canonical_path)
            if document.building_id != building_id:
                raise CorpusBuildError(f"Canonical building_id mismatch for {building_id}")
            try:
                report = build_pipeline_artifacts(document, staging / building_id, settings)
            except Exception as exc:
                raise CorpusBuildError(f"Embodied build failed for {building_id}: {exc}") from exc
            for key, value in report["trajectory_statistics"].items():
                if isinstance(value, int) and not isinstance(value, bool):
                    aggregate_statistics[key] = aggregate_statistics.get(key, 0) + value

        repair_summary = quality.get("repairs", {})
        summary = {
            "schema_version": "rural-embodied-corpus/1.0.0",
            "source_corpus_hash": manifest.get("corpus_hash"),
            "input_building_count": len(records),
            "valid_building_count": len(records),
            "excluded_building_count": 0,
            "artifact_count": len(records) * 6,
            "schema_validation_count": len(records) * 3,
            "repair_summary": {
                "repaired_wall_count": repair_summary.get("repaired_wall_count", 0),
                "source_area_mismatch_count": repair_summary.get(
                    "source_area_mismatch_count", 0
                ),
                "inferred_relation_count": repair_summary.get("inferred_relation_count", 0),
                "normalized_opening_type_count": repair_summary.get(
                    "normalized_opening_type_count", 0
                ),
            },
            "trajectory_statistics": dict(sorted(aggregate_statistics.items())),
        }
        write_json(staging / "excluded_buildings.json", {"buildings": []})
        write_json(staging / "corpus_summary.json", summary)
        _publish(staging, output_root, replace)
        if failure_path.exists():
            failure_path.unlink()
        return summary
    except Exception as exc:
        if staging.exists():
            shutil.rmtree(staging)
        error = exc if isinstance(exc, CorpusBuildError) else CorpusBuildError(str(exc))
        write_json(
            failure_path,
            {"status": "failed", "error_type": type(exc).__name__, "message": str(exc)},
        )
        raise error from exc
