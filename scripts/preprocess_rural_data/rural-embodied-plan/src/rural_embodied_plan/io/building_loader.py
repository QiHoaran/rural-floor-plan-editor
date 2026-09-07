"""BuildingDocument JSON loading and validation."""

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from rural_embodied_plan.domain.building import BuildingDocument


def load_building(path: Path) -> BuildingDocument:
    """Load a BuildingDocument without modifying its source file."""

    if not path.is_file():
        raise FileNotFoundError(f"Building JSON does not exist: {path}")
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid building JSON at {path}: {exc}") from exc
    try:
        document = BuildingDocument.model_validate(raw)
    except ValidationError as exc:
        raise ValueError(f"Unsupported or invalid BuildingDocument: {exc}") from exc
    if document.coordinate_system.get("storage_unit") != "mm":
        raise ValueError("Only millimetre BuildingDocument storage is supported")
    return document
