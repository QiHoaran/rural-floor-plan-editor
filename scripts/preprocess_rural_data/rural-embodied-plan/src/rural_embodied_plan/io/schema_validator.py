"""JSON Schema validation helpers."""

import json
from pathlib import Path
from typing import Any

import jsonschema


def validate_with_schema(instance: Any, schema_path: Path) -> None:
    """Validate a JSON-compatible value against a schema file."""

    schema: Any = json.loads(schema_path.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(schema).validate(instance)
