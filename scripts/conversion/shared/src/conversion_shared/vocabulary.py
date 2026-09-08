"""Shared label/ID vocabulary and small numeric helpers for all conversions."""

from __future__ import annotations

import copy
import math
from typing import Any

VOCABULARY_SCHEMA_VERSION = "rural-multimodal-vocabulary/1.0.0"
ROOM_SEMANTIC_IDS = {
    "none": 0,
    "bedroom": 1,
    "living_room": 2,
    "kitchen": 3,
    "storage": 4,
    "sunroom": 5,
    "unknown": 6,
}
WALL_TYPE_IDS = {"exterior": 1, "interior": 2, "partition": 3}
OPENING_TYPE_IDS = {
    "exterior_door": 1,
    "interior_door": 2,
    "passage": 3,
    "exterior_window": 4,
}
IMAGE_LABEL_IDS = {
    "background": 0,
    "room_bedroom": 1,
    "room_living_room": 2,
    "room_kitchen": 3,
    "room_storage": 4,
    "room_sunroom": 5,
    "room_unknown": 6,
    "wall_exterior": 16,
    "wall_interior": 17,
    "wall_partition": 18,
    "opening_exterior_door": 32,
    "opening_interior_door": 33,
    "opening_passage": 34,
    "opening_exterior_window": 35,
}
CAD_LAYERS = {
    "boundary": "BOUNDARY",
    "wall_exterior": "WALL_EXTERIOR",
    "wall_interior": "WALL_INTERIOR",
    "wall_partition": "WALL_PARTITION",
    "opening_exterior_door": "OPENING_EXTERIOR_DOOR",
    "opening_interior_door": "OPENING_INTERIOR_DOOR",
    "opening_passage": "OPENING_PASSAGE",
    "opening_exterior_window": "OPENING_EXTERIOR_WINDOW",
}
RESERVED_BUILDING_IDS = {
    "manifest",
    "vocabulary",
    "graphs",
    "graph.schema",
    "image.schema",
    "cad.schema",
    "primitives",
    "manifest.json",
    "vocabulary.json",
    "graphs.jsonl",
    "graph.schema.json",
    "image.schema.json",
    "cad.schema.json",
    "primitives.jsonl",
}
WINDOWS_DEVICE_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def multimodal_vocabulary() -> dict[str, Any]:
    """Return the public, versioned label and layer vocabulary."""

    return {
        "schema_version": VOCABULARY_SCHEMA_VERSION,
        "node_kinds": {"outside": 0, "room": 1},
        "room_semantics": copy.deepcopy(ROOM_SEMANTIC_IDS),
        "wall_types": copy.deepcopy(WALL_TYPE_IDS),
        "opening_types": copy.deepcopy(OPENING_TYPE_IDS),
        "image_labels": copy.deepcopy(IMAGE_LABEL_IDS),
        "cad_layers": copy.deepcopy(CAD_LAYERS),
        "node_feature_order": [
            "kind_id",
            "semantic_id",
            "area_ratio",
            "centroid_x_normalized",
            "centroid_y_normalized",
            "bbox_width_normalized",
            "bbox_height_normalized",
        ],
        "edge_channel_order": ["people", "air", "light"],
    }


def _require_vocabulary(value: str, vocabulary: dict[str, int], *, field: str) -> int:
    try:
        return vocabulary[value]
    except KeyError as error:
        raise ValueError(f"Unknown {field}: {value}") from error


def _rounded(value: float) -> float:
    return round(value, 12)


def _polygon_centroid(points: list[list[int]]) -> list[int]:
    twice_area = 0
    cx = 0
    cy = 0
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        cross = point[0] * following[1] - following[0] * point[1]
        twice_area += cross
        cx += (point[0] + following[0]) * cross
        cy += (point[1] + following[1]) * cross
    if twice_area == 0:
        raise ValueError("Room polygon has zero area")
    return [math.floor(cx / (3 * twice_area) + 0.5), math.floor(cy / (3 * twice_area) + 0.5)]
