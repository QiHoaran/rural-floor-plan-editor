"""Small JSON Schema document builders shared by graph and cad schemas."""

from __future__ import annotations

from typing import Any


def _nullable(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


def _point_schema(*, number_type: str = "integer") -> dict[str, Any]:
    return {
        "type": "array",
        "minItems": 2,
        "maxItems": 2,
        "items": {"type": number_type},
    }


def _closed_object(
    required: list[str], properties: dict[str, Any]
) -> dict[str, Any]:
    return {
        "type": "object",
        "required": required,
        "properties": properties,
        "additionalProperties": False,
    }
