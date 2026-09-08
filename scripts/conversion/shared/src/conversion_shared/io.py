"""Deterministic JSON/artifact IO and path-safety helpers."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .vocabulary import RESERVED_BUILDING_IDS, WINDOWS_DEVICE_NAMES


def _json_bytes(value: Any, *, pretty: bool = True) -> bytes:
    options: dict[str, Any] = {"ensure_ascii": False, "sort_keys": True}
    if pretty:
        options["indent"] = 2
    else:
        options["separators"] = (",", ":")
    return (json.dumps(value, **options) + "\n").encode("utf-8")


def _write_json(path: Path, value: Any, *, pretty: bool = True) -> str:
    encoded = _json_bytes(value, pretty=pretty)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest()


def _write_jsonl(path: Path, values: Any) -> str:
    encoded = b"".join(_json_bytes(value, pretty=False) for value in values)
    path.write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _artifact(path: str, sha256: str, **details: Any) -> dict[str, Any]:
    return {"path": path.replace("\\", "/"), "sha256": sha256, **details}


def _safe_output_path(root: Path, *parts: str) -> Path:
    resolved_root = root.resolve()
    candidate = resolved_root.joinpath(*parts).resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(f"Output artifact escapes staging root: {candidate}") from error
    return candidate


def _validate_building_id(building_id: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", building_id):
        raise ValueError(f"building_id must be a safe filename: {building_id!r}")
    if building_id.endswith((".", " ")):
        raise ValueError(f"building_id must be a safe filename: {building_id!r}")
    device_stem = building_id.split(".", 1)[0].upper()
    if device_stem in WINDOWS_DEVICE_NAMES:
        raise ValueError(f"building_id must not use a Windows device name: {building_id!r}")
    if building_id.lower() in RESERVED_BUILDING_IDS:
        raise ValueError(f"building_id is reserved for corpus artifacts: {building_id!r}")


def _load_hashed_json(
    root: Path, relative_path: str, expected_sha256: str, *, label: str
) -> dict[str, Any]:
    root = root.resolve()
    path = (root / relative_path).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ValueError(f"{label} path escapes the cleaned corpus root") from error
    encoded = path.read_bytes()
    actual_sha256 = hashlib.sha256(encoded).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError(f"{label} SHA-256 mismatch for {relative_path}")
    value = json.loads(encoded)
    if not isinstance(value, dict):
        raise ValueError(f"{label} record must be a JSON object")
    return value
