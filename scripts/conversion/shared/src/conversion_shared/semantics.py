"""Stable semantic labels for source room annotations."""

from __future__ import annotations


_NAME_TO_CODE = {
    "卧室": "bedroom",
    "客厅": "living_room",
    "厨房": "kitchen",
    "杂物间": "storage",
    "阳光房": "sunroom",
}

_STABLE_CODES = {"bedroom", "living_room", "kitchen", "storage", "sunroom"}


def normalize_room_semantic(code: object, display_name: object) -> str:
    """Return a stable room code while retaining unknowns in the source record."""

    name = display_name.strip() if isinstance(display_name, str) else ""
    if name in _NAME_TO_CODE:
        return _NAME_TO_CODE[name]
    normalized_code = code.strip() if isinstance(code, str) else ""
    return normalized_code if normalized_code in _STABLE_CODES else "unknown"

