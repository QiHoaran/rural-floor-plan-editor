"""Deterministic semantic and room-instance masks for cleaned floor plans."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from conversion_shared.corpus import CleanedCorpus
from conversion_shared.io import _artifact, _safe_output_path, _sha256, _write_json
from conversion_shared.schemas import validate_json_schema
from conversion_shared.vocabulary import (
    IMAGE_LABEL_IDS,
    OPENING_TYPE_IDS,
    ROOM_SEMANTIC_IDS,
    WALL_TYPE_IDS,
    _require_vocabulary,
)


@dataclass(frozen=True)
class RenderedMasks:
    semantic: Image.Image
    instance: Image.Image
    stats: dict[str, Any]


def image_schema_document() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "rural-training-image-stats/1.0.0",
        "type": "object",
        "required": [
            "schema_version",
            "record_id",
            "width",
            "height",
            "semantic_mode",
            "instance_mode",
            "semantic_histogram",
            "instance_histogram",
        ],
        "properties": {
            "schema_version": {"const": "rural-training-image-stats/1.0.0"},
            "record_id": {"type": "string"},
            "width": {"const": 256},
            "height": {"const": 256},
            "semantic_mode": {"const": "P"},
            "instance_mode": {"const": "I;16"},
            "semantic_histogram": {
                "type": "object",
                "additionalProperties": {"type": "integer", "minimum": 1},
            },
            "instance_histogram": {
                "type": "object",
                "additionalProperties": {"type": "integer", "minimum": 1},
            },
        },
        "additionalProperties": False,
    }


def _image_point(point: list[int], grid_size: int) -> tuple[int, int]:
    x = int(point[0])
    y = int(point[1])
    if not (0 <= x < grid_size and 0 <= y < grid_size):
        raise ValueError(f"Grid point is outside [0, {grid_size - 1}]: {point}")
    return x, grid_size - 1 - y


def _semantic_palette() -> list[int]:
    palette = [0] * (256 * 3)
    colors = {
        0: (0, 0, 0),
        1: (76, 120, 168),
        2: (245, 133, 24),
        3: (228, 87, 86),
        4: (114, 183, 178),
        5: (84, 162, 75),
        6: (186, 176, 172),
        16: (40, 40, 40),
        17: (90, 90, 90),
        18: (130, 130, 130),
        32: (215, 25, 28),
        33: (253, 174, 97),
        34: (171, 221, 164),
        35: (43, 131, 186),
    }
    for label, color in colors.items():
        palette[label * 3 : label * 3 + 3] = color
    return palette


def _histogram(image: Image.Image) -> dict[str, int]:
    counts = Counter(int(value) for value in image.get_flattened_data())
    return {str(value): counts[value] for value in sorted(counts)}


def render_training_masks(training: dict[str, Any]) -> RenderedMasks:
    """Render deterministic semantic and room-instance masks from a training record."""

    grid = training["grid"]
    grid_size = int(grid["size"])
    if grid_size != 256:
        raise ValueError(f"Unsupported training grid size: {grid_size}")
    semantic = Image.new("P", (grid_size, grid_size), color=IMAGE_LABEL_IDS["background"])
    semantic.putpalette(_semantic_palette())
    instance = Image.new("I;16", (grid_size, grid_size), color=0)
    semantic_draw = ImageDraw.Draw(semantic)
    instance_draw = ImageDraw.Draw(instance)

    rooms = sorted(training["rooms"], key=lambda room: int(room["index"]))
    for expected_index, room in enumerate(rooms):
        if int(room["index"]) != expected_index:
            raise ValueError("Room indices must be contiguous from zero")
        semantic_name = str(room["semantic"])
        _require_vocabulary(semantic_name, ROOM_SEMANTIC_IDS, field="room semantic")
        label = IMAGE_LABEL_IDS[f"room_{semantic_name}"]
        polygon = [_image_point(point, grid_size) for point in room["polygon"]]
        semantic_draw.polygon(polygon, fill=label)
        instance_draw.polygon(polygon, fill=expected_index + 1)

    scale = float(grid["transform"]["scale_mm_to_grid"])
    walls = {int(wall["index"]): wall for wall in training["walls"]}
    wall_widths: dict[int, int] = {}
    for wall_index in sorted(walls):
        wall = walls[wall_index]
        wall_type = str(wall["wall_type"])
        _require_vocabulary(wall_type, WALL_TYPE_IDS, field="wall type")
        width = max(1, math.floor(float(wall["thickness_mm"]) * scale + 0.5))
        wall_widths[wall_index] = width
        segment = [_image_point(point, grid_size) for point in wall["segment"]]
        semantic_draw.line(segment, fill=IMAGE_LABEL_IDS[f"wall_{wall_type}"], width=width)
        instance_draw.line(segment, fill=0, width=width)

    for opening in sorted(training["openings"], key=lambda item: int(item["index"])):
        opening_type = str(opening["type"])
        _require_vocabulary(opening_type, OPENING_TYPE_IDS, field="opening type")
        host_wall_index = int(opening["host_wall_index"])
        if host_wall_index not in wall_widths:
            raise ValueError(f"Opening references missing host wall index {host_wall_index}")
        segment = [_image_point(point, grid_size) for point in opening["segment"]]
        width = wall_widths[host_wall_index]
        semantic_draw.line(
            segment,
            fill=IMAGE_LABEL_IDS[f"opening_{opening_type}"],
            width=width,
        )
        instance_draw.line(segment, fill=0, width=width)

    return RenderedMasks(
        semantic=semantic,
        instance=instance,
        stats={
            "schema_version": "rural-training-image-stats/1.0.0",
            "record_id": str(training["record_id"]),
            "width": grid_size,
            "height": grid_size,
            "semantic_mode": "P",
            "instance_mode": "I;16",
            "semantic_histogram": _histogram(semantic),
            "instance_histogram": _histogram(instance),
        },
    )


def _validate_image_integrity(rendered: RenderedMasks) -> None:
    stats = rendered.stats
    semantic = {int(key): value for key, value in stats["semantic_histogram"].items()}
    instances = {int(key): value for key, value in stats["instance_histogram"].items()}
    if set(semantic) - set(IMAGE_LABEL_IDS.values()):
        raise ValueError("Semantic mask contains an unregistered label")
    if 0 not in instances or any(label < 0 or label > 65535 for label in instances):
        raise ValueError("Instance mask contains an invalid label")
    expected_pixels = stats["width"] * stats["height"]
    if sum(semantic.values()) != expected_pixels or sum(instances.values()) != expected_pixels:
        raise ValueError("Image histograms do not cover every pixel")


def build_tree(
    corpus: CleanedCorpus, root: Path
) -> tuple[list[dict[str, Any]], list[str]]:
    """Write image artifacts and return per-record manifests and corpus artifact paths."""

    schema = image_schema_document()
    _write_json(_safe_output_path(root, "image.schema.json"), schema)
    manifest_records: list[dict[str, Any]] = []
    for record in corpus.records:
        rendered = render_training_masks(record.training)
        validate_json_schema(rendered.stats, schema)
        _validate_image_integrity(rendered)
        record_root = _safe_output_path(root, record.building_id)
        record_root.mkdir(parents=True)
        semantic_path = record_root / "semantic.png"
        instance_path = record_root / "instance.png"
        rendered.semantic.save(semantic_path, format="PNG", optimize=False, compress_level=9)
        rendered.instance.save(instance_path, format="PNG", optimize=False, compress_level=9)
        stats_path = record_root / "stats.json"
        stats_sha256 = _write_json(stats_path, rendered.stats)
        manifest_records.append(
            {
                "building_id": record.building_id,
                "record_id": record.record_id,
                "artifacts": [
                    _artifact(
                        f"{record.building_id}/semantic.png",
                        _sha256(semantic_path),
                        mode="P",
                        size=[256, 256],
                        histogram=rendered.stats["semantic_histogram"],
                    ),
                    _artifact(
                        f"{record.building_id}/instance.png",
                        _sha256(instance_path),
                        mode="I;16",
                        size=[256, 256],
                        histogram=rendered.stats["instance_histogram"],
                    ),
                    _artifact(f"{record.building_id}/stats.json", stats_sha256),
                ],
            }
        )
    return manifest_records, ["image.schema.json"]
