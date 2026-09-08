"""Verified, no-overwrite corpus generation and source-backed read-back audit."""

import hashlib
import json
import re
import tempfile
from collections import Counter
from collections.abc import Callable
from fractions import Fraction
from pathlib import Path
from typing import Any, cast

from embodied.config import Config
from embodied.pipeline import build_artifacts, json_value
from embodied.vocabulary import vocabulary


def read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(json_value(value), ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def adapt_cleaned(raw: dict[str, Any]) -> dict[str, Any]:
    """Preserve original semantic nulls and unsupported geometry for strict preflight."""
    if raw.get("schema_version") != "rural-clean-canonical/1.0.0":
        raise ValueError("INPUT_SCHEMA_MISMATCH")
    converted = dict(raw)
    for key in ("walls", "wall_elements", "outside_regions"):
        items = raw.get(key, [])
        converted[key] = {item["id"]: dict(item) for item in items}
        if len(converted[key]) != len(items):
            raise ValueError(f"DUPLICATE_INPUT_ID: {key}")
    converted["faces"] = {
        room["id"]: {
            **room.get("properties", {}),
            **room,
            "function_code": room.get("original_function_code", room.get("semantic")),
        }
        for room in raw["rooms"]
    }
    if len(converted["faces"]) != len(raw["rooms"]):
        raise ValueError("DUPLICATE_INPUT_ID: rooms")
    # Source extensions cannot hide explicitly supplied geometry from preflight.
    for key in ("obstacles", "interior_obstacles", "holes", "interior_rings"):
        extension = raw.get("source_extensions", {}).get(key)
        if extension:
            converted[key] = extension
    return converted


def source_records(root: Path) -> list[dict[str, Any]]:
    manifest = read(root / "manifest.json")
    records = manifest["records"]
    if (
        manifest.get("schema_version") != "rural-clean-manifest/1.0.0"
        or manifest.get("building_count") != len(records)
        or not records
    ):
        raise ValueError("INPUT_MANIFEST_INVALID")
    identifiers = [r["building_id"] for r in records]
    if len(set(identifiers)) != len(records) or any(
        not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name) for name in identifiers
    ):
        raise ValueError("INPUT_BUILDING_ID_INVALID")
    for record in records:
        path = (root / record["canonical_file"]).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError("INPUT_PATH_ESCAPE")
        if sha(path) != record["canonical_sha256"]:
            raise ValueError(f"SOURCE_HASH_MISMATCH: {record['building_id']}")
        if read(path)["building_id"] != record["building_id"]:
            raise ValueError("INPUT_BUILDING_ID_MISMATCH")
    return sorted(records, key=lambda r: r["building_id"])


def hashes(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): sha(p) for p in sorted(root.rglob("*")) if p.is_file()}


def distribution(values: list[int]) -> dict[str, Any]:
    if not values:
        return {"count": 0, "sum": 0}
    ordered = sorted(values)
    return {
        "count": len(values),
        "sum": sum(values),
        "min": ordered[0],
        "max": ordered[-1],
        "mean": round(sum(values) / len(values), 3),
        **{
            f"p{p}": ordered[max(0, (len(values) * p + 99) // 100 - 1)] for p in (5, 25, 50, 75, 95)
        },
    }


def summarize(records: list[dict[str, Any]], config: Config) -> dict[str, Any]:
    valid = [r["report"] for r in records if r["report"]["status"] == "valid"]
    quarantined = [r["report"] for r in records if r["report"]["status"] != "valid"]
    durations = [
        Fraction(r["total_execution_ms"]["num"], r["total_execution_ms"]["den"]) for r in valid
    ]
    return cast(
        dict[str, Any],
        json_value(
            {
                "schema_version": "embodied-corpus-summary/2",
                "policy_version": config.policy_version,
                "input_building_count": len(records),
                "valid_building_count": len(valid),
                "quarantined_building_count": len(quarantined),
                "valid_percent": round(100 * len(valid) / len(records), 3),
                "quarantine_reasons": dict(
                    sorted(Counter(r["reason_code"] for r in quarantined).items())
                ),
                "vocabulary_size": len(vocabulary(config)),
                "distributions": {
                    key: distribution([r[key] for r in valid])
                    for key in (
                        "room_count",
                        "wall_count",
                        "opening_count",
                        "door_count",
                        "window_count",
                        "component_count",
                        "token_count",
                        "event_count",
                        "action_count",
                        "observation_count",
                        "loop_count",
                    )
                },
                "multi_component_building_count": sum(r["component_count"] > 1 for r in valid),
                "total_execution_ms": sum(durations, Fraction(0)),
                "execution_ms_rounded_for_statistics": distribution([round(t) for t in durations]),
                "all_valid_roundtrip_exact": all(r["roundtrip_exact"] for r in valid),
                "scope": (
                    "canonical-floorplan/2; normalized translation "
                    "and documented metadata exclusions"
                ),
                "physical_scope": "nominal 2D geometry; outside environment not available",
                "component_transfers": (
                    "explicit session RESET, not physical movement; no transfer time"
                ),
                "training_started": False,
            }
        ),
    )


def check_publication_report(report: dict[str, Any]) -> None:
    if report.get("reason_code") in {
        "TOKEN_GRAMMAR_ERROR",
        "FLOORPLAN_ROUNDTRIP_MISMATCH",
        "NON_DETERMINISTIC_REENCODE",
    }:
        raise ValueError(f"CODEC_PUBLICATION_BLOCKED: {report['reason']}")


def audit_corpus(
    output: Path, input_root: Path, progress: Callable[[str], None] | None = None
) -> dict[str, Any]:
    """Rebuild from hash-verified sources and compare every persisted artifact byte.

    Each rebuild also runs the independent token-only decoder, physical replay,
    exact source-target comparison, re-encoding and all five artifact schemas.
    Quarantine decisions must reproduce; unknown exceptions abort the audit.
    """
    source = source_records(input_root)
    manifest = read(output / "corpus_manifest.json")
    config = Config.model_validate(read(output / "robot_config.json"))
    if manifest["source_manifest_sha256"] != sha(input_root / "manifest.json"):
        raise ValueError("SOURCE_MANIFEST_HASH_MISMATCH")
    if manifest["robot_config_sha256"] != config.digest():
        raise ValueError("CONFIG_MISMATCH")
    records = manifest["records"]
    if [r["building_id"] for r in records] != [r["building_id"] for r in source]:
        raise ValueError("CORPUS_COVERAGE_MISMATCH")
    expected_files = {
        "corpus_manifest.json",
        "corpus_summary.json",
        "robot_config.json",
        "dataset_audit.json",
        "dataset_report.md",
    }
    for index, (record, original) in enumerate(zip(records, source, strict=True), 1):
        quarantined = record["report"]["status"] == "quarantined"
        relative = ("quarantine/" if quarantined else "") + record["building_id"]
        if record["artifact_directory"] != relative:
            raise ValueError("CORPUS_PATH_MISMATCH")
        destination = output / relative
        if hashes(destination) != record["artifact_sha256"]:
            raise ValueError(f"ARTIFACT_HASH_MISMATCH: {relative}")
        expected_files.update(f"{relative}/{p}" for p in record["artifact_sha256"])
        with tempfile.TemporaryDirectory(prefix="readback-") as temp:
            regenerated = Path(temp) / "building"
            report = build_artifacts(
                adapt_cleaned(read(input_root / original["canonical_file"])), regenerated, config
            )
            check_publication_report(report)
            if report != record["report"] or hashes(regenerated) != record["artifact_sha256"]:
                raise ValueError(f"NON_DETERMINISTIC_CORPUS: {relative}")
        if progress and (index % 25 == 0 or index == len(records)):
            progress(f"audit {index}/{len(records)}")
    actual_files = {p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()}
    if actual_files - expected_files:
        raise ValueError("UNMANIFESTED_ARTIFACTS")
    if read(output / "corpus_summary.json") != summarize(records, config):
        raise ValueError("SUMMARY_MISMATCH")
    return {
        "schema_version": "embodied-dataset-audit/2",
        "status": "valid",
        "input_building_count": len(source),
        "valid_building_count": sum(r["report"]["status"] == "valid" for r in records),
        "quarantined_building_count": sum(r["report"]["status"] == "quarantined" for r in records),
        "checks": {
            k: True
            for k in (
                "source_hashes",
                "complete_coverage",
                "artifact_hashes",
                "schema_validation",
                "token_only_decode",
                "floorplan_roundtrip_exact",
                "token_roundtrip_exact",
                "physical_replay_nominal_2d",
                "byte_identical_regeneration",
                "quarantine_reproducible",
                "no_unmanifested_artifacts",
                "summary_recomputed",
            )
        },
        "training_started": False,
    }


def build_corpus(
    input_root: Path,
    output: Path,
    config: Config | None = None,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    output = output.resolve()
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    config = config or Config()
    source = source_records(input_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-staging-", dir=output.parent))
    records = []
    for index, original in enumerate(source, 1):
        identifier = original["building_id"]
        destination = staging / identifier
        report = build_artifacts(
            adapt_cleaned(read(input_root / original["canonical_file"])), destination, config
        )
        check_publication_report(report)
        relative = identifier
        if report["status"] == "quarantined":
            relative = f"quarantine/{identifier}"
            (staging / "quarantine").mkdir(exist_ok=True)
            destination.rename(staging / relative)
            destination = staging / relative
        records.append(
            {
                "building_id": identifier,
                "canonical_file": original["canonical_file"],
                "canonical_sha256": original["canonical_sha256"],
                "artifact_directory": relative,
                "artifact_sha256": hashes(destination),
                "report": report,
            }
        )
        if progress and (index % 25 == 0 or index == len(source)):
            progress(
                f"generate {index}/{len(source)}; valid="
                f"{sum(r['report']['status'] == 'valid' for r in records)}"
            )
    write(staging / "robot_config.json", config.model_dump(mode="json"))
    write(
        staging / "corpus_manifest.json",
        {
            "schema_version": "embodied-corpus-manifest/2",
            "records": records,
            "source_manifest_sha256": sha(input_root / "manifest.json"),
            "robot_config_sha256": config.digest(),
            "policy_version": config.policy_version,
        },
    )
    summary = summarize(records, config)
    write(staging / "corpus_summary.json", summary)
    audit = audit_corpus(staging, input_root, progress)
    write(staging / "dataset_audit.json", audit)
    lines = [
        "# Embodied corpus generation + audit",
        "",
        f"Input: {len(source)}; valid: {summary['valid_building_count']}; "
        f"quarantine: {summary['quarantined_building_count']}.",
        "",
        "Every artifact was regenerated from verified sources and compared byte-for-byte.",
        "Valid buildings passed token-only decoding, exact round trips and nominal 2D replay.",
        "Component transfers are explicit RESET sessions, not continuous outdoor travel.",
        "No model training. Source IDs are metadata, never vocabulary entries.",
        "",
        "## Quarantine reasons",
        "",
    ]
    lines += [f"- {k}: {v}" for k, v in summary["quarantine_reasons"].items()]
    lines += [
        "",
        "## Statistics (valid buildings)",
        "",
        "```json",
        json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2),
        "```",
        "",
    ]
    (staging / "dataset_report.md").write_text("\n".join(lines), encoding="utf-8")
    staging.rename(output)
    return summary
