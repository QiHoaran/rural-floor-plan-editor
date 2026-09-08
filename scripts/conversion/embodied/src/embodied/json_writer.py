"""Stable UTF-8 JSON serialization."""

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel


def write_json(path: Path, value: BaseModel | dict[str, Any] | list[Any]) -> None:
    """Write deterministic, human-readable JSON with sorted object keys."""

    path.parent.mkdir(parents=True, exist_ok=True)
    payload: Any = (
        value.model_dump(mode="json", exclude_none=False) if isinstance(value, BaseModel) else value
    )
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def read_json(path: Path) -> Any:
    """Read arbitrary JSON with a clear missing-file error."""

    if not path.is_file():
        raise FileNotFoundError(f"JSON file does not exist: {path}")
    return json.loads(path.read_text(encoding="utf-8"))
