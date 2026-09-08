"""Source discovery for rural building autosaves."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class BuildingSource:
    building_id: str
    path: Path
    relative_path: str
    sha256: str
    document: dict[str, Any]


def discover_sources(root: Path) -> list[BuildingSource]:
    """Read every project autosave and return sources sorted by building ID."""

    root = root.resolve()
    sources: list[BuildingSource] = []
    seen_ids: set[str] = set()
    for path in sorted(root.glob("*/draft/building.autosave.json")):
        raw = path.read_bytes()
        document = json.loads(raw.decode("utf-8"))
        if not isinstance(document, dict):
            raise ValueError(f"Building source must be a JSON object: {path}")
        building_id = document.get("building_id")
        if not isinstance(building_id, str) or not building_id:
            raise ValueError(f"Missing building_id: {path}")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", building_id):
            raise ValueError(f"building_id must be a safe filename: {building_id!r}")
        if building_id in seen_ids:
            raise ValueError(f"Duplicate building_id: {building_id}")
        seen_ids.add(building_id)
        sources.append(
            BuildingSource(
                building_id=building_id,
                path=path,
                relative_path=path.relative_to(root).as_posix(),
                sha256=hashlib.sha256(raw).hexdigest(),
                document=document,
            )
        )
    return sources
