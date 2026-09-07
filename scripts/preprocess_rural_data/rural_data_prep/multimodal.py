"""Deterministic model-training representations for cleaned floor plans."""

from __future__ import annotations

import copy
import ctypes
import hashlib
import json
import logging
import math
import os
import re
import shutil
import tempfile
import threading
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageDraw, __version__ as pillow_version

from .schemas import schema_documents, validate_json_schema


GRAPH_SCHEMA_VERSION = "rural-training-graph/1.0.0"
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
_EZDXF_WRITE_LOCK = threading.Lock()
_PUBLICATION_MARKER = ".rural_data_prep_transaction.json"
_PUBLICATION_MARKER_SCHEMA = "rural-model-ready-transaction/1.0.0"


@dataclass(frozen=True)
class CleanedRecord:
    building_id: str
    record_id: str
    canonical: dict[str, Any]
    training: dict[str, Any]


@dataclass(frozen=True)
class CleanedCorpus:
    input_root: Path
    corpus_hash: str
    manifest: dict[str, Any]
    records: tuple[CleanedRecord, ...]


@dataclass(frozen=True)
class RenderedMasks:
    semantic: Image.Image
    instance: Image.Image
    stats: dict[str, Any]


@dataclass(frozen=True)
class ConversionSummary:
    modality: str
    source_corpus_hash: str
    record_count: int
    output_root: Path
    dry_run: bool
    files_written: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "modality": self.modality,
            "source_corpus_hash": self.source_corpus_hash,
            "record_count": self.record_count,
            "output_root": str(self.output_root),
            "dry_run": self.dry_run,
            "files_written": self.files_written,
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


def graph_schema_document() -> dict[str, Any]:
    """Return the JSON Schema for public graph records."""

    number_or_null = _nullable({"type": "number"})
    point = _point_schema()
    node = _closed_object(
        [
            "node_index", "kind", "kind_id", "semantic", "semantic_id",
            "area_mm2", "area_ratio", "polygon_grid", "centroid_grid",
            "bbox_grid", "features",
        ],
        {
            "node_index": {"type": "integer", "minimum": 0},
            "kind": {"anyOf": [{"const": "outside"}, {"const": "room"}]},
            "kind_id": {"type": "integer", "minimum": 0},
            "semantic": {"type": "string"},
            "semantic_id": {"type": "integer", "minimum": 0},
            "area_mm2": {"type": "integer", "minimum": 0},
            "area_ratio": {"type": "number", "minimum": 0},
            "polygon_grid": {"type": "array", "items": point},
            "centroid_grid": _nullable(point),
            "bbox_grid": _nullable(
                {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "integer"}}
            ),
            "features": {
                "type": "array", "minItems": 7, "maxItems": 7,
                "items": {"type": "number"},
            },
        },
    )
    edge = _closed_object(
        [
            "edge_index", "source", "target", "opening_index", "relation_type",
            "opening_type", "opening_type_id", "channels", "width_mm", "height_mm",
            "sill_height_mm", "center_grid", "center_normalized", "host_wall_type",
            "is_exterior",
        ],
        {
            "edge_index": {"type": "integer", "minimum": 0},
            "source": {"type": "integer", "minimum": 0},
            "target": {"type": "integer", "minimum": 0},
            "opening_index": {"type": "integer", "minimum": 0},
            "relation_type": _nullable({"type": "string"}),
            "opening_type": {"type": "string"},
            "opening_type_id": {"type": "integer", "minimum": 1},
            "channels": {
                "type": "array", "minItems": 3, "maxItems": 3,
                "items": {"anyOf": [{"const": 0}, {"const": 1}]},
            },
            "width_mm": number_or_null,
            "height_mm": number_or_null,
            "sill_height_mm": number_or_null,
            "center_grid": point,
            "center_normalized": {
                "type": "array", "minItems": 2, "maxItems": 2,
                "items": {"type": "number"},
            },
            "host_wall_type": {"type": "string"},
            "is_exterior": {"type": "boolean"},
        },
    )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": GRAPH_SCHEMA_VERSION,
        "type": "object",
        "required": [
            "schema_version",
            "record_id",
            "building_id",
            "conditions",
            "grid",
            "nodes",
            "edges",
            "counts",
        ],
        "properties": {
            "schema_version": {"const": GRAPH_SCHEMA_VERSION},
            "record_id": {"type": "string"},
            "building_id": {"type": "string"},
            "conditions": {
                "type": "object",
                "additionalProperties": {
                    "anyOf": [
                        {"type": "string"}, {"type": "number"},
                        {"type": "boolean"}, {"type": "null"},
                    ]
                },
            },
            "grid": _closed_object(
                ["size", "padding", "north_is_positive_y", "transform"],
                {
                    "size": {"const": 256},
                    "padding": {"type": "integer", "minimum": 0},
                    "north_is_positive_y": {"const": True},
                    "transform": _closed_object(
                        ["grid_size", "padding", "rotation_deg", "source_bbox_mm", "rotated_bbox_mm", "scale_mm_to_grid", "offset_grid", "rounding"],
                        {
                            "grid_size": {"const": 256},
                            "padding": {"type": "integer", "minimum": 0},
                            "rotation_deg": {"type": "number"},
                            "source_bbox_mm": {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "number"}},
                            "rotated_bbox_mm": {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "number"}},
                            "scale_mm_to_grid": {"type": "number", "minimum": 0},
                            "offset_grid": _point_schema(number_type="number"),
                            "rounding": {"const": "half_up"},
                        },
                    ),
                },
            ),
            "nodes": {"type": "array", "minItems": 2, "items": node},
            "edges": {"type": "array", "items": edge},
            "counts": _closed_object(
                ["nodes", "rooms", "edges"],
                {name: {"type": "integer", "minimum": 0} for name in ("nodes", "rooms", "edges")},
            ),
        },
        "additionalProperties": False,
    }


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


def cad_schema_document() -> dict[str, Any]:
    point = _point_schema()
    number_or_null = _nullable({"type": "number"})
    boundary = _closed_object(
        ["primitive_id", "layer", "vertices_mm", "closed"],
        {
            "primitive_id": {"type": "string"},
            "layer": {"const": "BOUNDARY"},
            "vertices_mm": {"type": "array", "minItems": 3, "items": point},
            "closed": {"const": True},
        },
    )
    room = _closed_object(
        ["primitive_id", "layer", "semantic", "semantic_id", "vertices_mm", "closed", "area_mm2"],
        {
            "primitive_id": {"type": "string"}, "layer": {"type": "string"},
            "semantic": {"type": "string"}, "semantic_id": {"type": "integer", "minimum": 1},
            "vertices_mm": {"type": "array", "minItems": 3, "items": point},
            "closed": {"const": True}, "area_mm2": {"type": "integer", "minimum": 1},
        },
    )
    wall = _closed_object(
        ["primitive_id", "layer", "wall_type", "wall_type_id", "start_mm", "end_mm", "thickness_mm", "height_mm"],
        {
            "primitive_id": {"type": "string"}, "layer": {"type": "string"},
            "wall_type": {"type": "string"}, "wall_type_id": {"type": "integer", "minimum": 1},
            "start_mm": point, "end_mm": point,
            "thickness_mm": number_or_null, "height_mm": number_or_null,
        },
    )
    opening = _closed_object(
        ["primitive_id", "layer", "opening_type", "opening_type_id", "host_wall_id", "start_mm", "end_mm", "center_mm", "width_mm", "height_mm", "sill_height_mm"],
        {
            "primitive_id": {"type": "string"}, "layer": {"type": "string"},
            "opening_type": {"type": "string"}, "opening_type_id": {"type": "integer", "minimum": 1},
            "host_wall_id": {"type": "string"}, "start_mm": point, "end_mm": point,
            "center_mm": point, "width_mm": number_or_null, "height_mm": number_or_null,
            "sill_height_mm": number_or_null,
        },
    )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "rural-training-cad/1.0.0",
        "type": "object",
        "required": [
            "schema_version",
            "record_id",
            "building_id",
            "units",
            "coordinate_system",
            "boundaries",
            "rooms",
            "walls",
            "openings",
            "counts",
        ],
        "properties": {
            "schema_version": {"const": "rural-training-cad/1.0.0"},
            "record_id": {"type": "string"},
            "building_id": {"type": "string"},
            "units": {"const": "millimeters"},
            "coordinate_system": _closed_object(
                ["x_positive", "y_positive"],
                {"x_positive": {"const": "east"}, "y_positive": {"const": "north"}},
            ),
            "boundaries": {"type": "array", "minItems": 1, "items": boundary},
            "rooms": {"type": "array", "minItems": 1, "items": room},
            "walls": {"type": "array", "minItems": 1, "items": wall},
            "openings": {"type": "array", "items": opening},
            "counts": _closed_object(
                ["boundaries", "rooms", "walls", "openings"],
                {name: {"type": "integer", "minimum": 0} for name in ("boundaries", "rooms", "walls", "openings")},
            ),
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


def build_cad_primitives(canonical: dict[str, Any]) -> dict[str, Any]:
    """Build stable millimetre vector primitives from one canonical record."""

    vertices = canonical["vertices"]
    default_height = canonical.get("building_defaults", {}).get("wall_height_mm")
    boundaries = [
        {
            "primitive_id": f"boundary_{index:04d}",
            "layer": CAD_LAYERS["boundary"],
            "vertices_mm": [[int(point[0]), int(point[1])] for point in component],
            "closed": True,
        }
        for index, component in enumerate(
            canonical["derived"]["occupied_boundary_components_mm"], start=1
        )
    ]
    rooms: list[dict[str, Any]] = []
    for room in sorted(canonical["rooms"], key=lambda item: str(item["id"])):
        semantic = str(room["semantic"])
        _require_vocabulary(semantic, ROOM_SEMANTIC_IDS, field="room semantic")
        rooms.append(
            {
                "primitive_id": str(room["id"]),
                "layer": f"ROOM_{semantic.upper()}",
                "semantic": semantic,
                "semantic_id": ROOM_SEMANTIC_IDS[semantic],
                "vertices_mm": [
                    [int(point[0]), int(point[1])] for point in room["polygon_mm"]
                ],
                "closed": True,
                "area_mm2": int(room["area_mm2"]),
            }
        )
    walls: list[dict[str, Any]] = []
    wall_ids: set[str] = set()
    for wall in sorted(canonical["walls"], key=lambda item: str(item["id"])):
        wall_id = str(wall["id"])
        wall_type = str(wall["wall_type"])
        _require_vocabulary(wall_type, WALL_TYPE_IDS, field="wall type")
        start = vertices[str(wall["start_vertex_id"])]
        end = vertices[str(wall["end_vertex_id"])]
        walls.append(
            {
                "primitive_id": wall_id,
                "layer": CAD_LAYERS[f"wall_{wall_type}"],
                "wall_type": wall_type,
                "wall_type_id": WALL_TYPE_IDS[wall_type],
                "start_mm": [int(start["x_mm"]), int(start["y_mm"])],
                "end_mm": [int(end["x_mm"]), int(end["y_mm"])],
                "thickness_mm": wall.get("thickness_mm"),
                "height_mm": wall.get("height_mm", default_height),
            }
        )
        wall_ids.add(wall_id)
    openings: list[dict[str, Any]] = []
    for opening in sorted(canonical["wall_elements"], key=lambda item: str(item["id"])):
        opening_type = str(opening["element_type"])
        _require_vocabulary(opening_type, OPENING_TYPE_IDS, field="opening type")
        host_wall_id = str(opening["host_wall_id"])
        if host_wall_id not in wall_ids:
            raise ValueError(f"Opening references missing host wall {host_wall_id}")
        segment = opening["segment_mm"]
        openings.append(
            {
                "primitive_id": str(opening["id"]),
                "layer": CAD_LAYERS[f"opening_{opening_type}"],
                "opening_type": opening_type,
                "opening_type_id": OPENING_TYPE_IDS[opening_type],
                "host_wall_id": host_wall_id,
                "start_mm": [int(segment[0][0]), int(segment[0][1])],
                "end_mm": [int(segment[1][0]), int(segment[1][1])],
                "center_mm": [int(opening["center_mm"][0]), int(opening["center_mm"][1])],
                "width_mm": opening.get("width_mm"),
                "height_mm": opening.get("height_mm"),
                "sill_height_mm": opening.get("sill_height_mm"),
            }
        )
    return {
        "schema_version": "rural-training-cad/1.0.0",
        "record_id": str(canonical["record_id"]),
        "building_id": str(canonical["building_id"]),
        "units": "millimeters",
        "coordinate_system": {"x_positive": "east", "y_positive": "north"},
        "boundaries": boundaries,
        "rooms": rooms,
        "walls": walls,
        "openings": openings,
        "counts": {
            "boundaries": len(boundaries),
            "rooms": len(rooms),
            "walls": len(walls),
            "openings": len(openings),
        },
    }


def write_dxf(primitives: dict[str, Any], output_path: Path) -> None:
    """Write and structurally verify a deterministic DXF R2010 document."""

    logging.getLogger("ezdxf").setLevel(logging.ERROR)
    import ezdxf
    from ezdxf import units

    with _EZDXF_WRITE_LOCK:
        previous = ezdxf.options.write_fixed_meta_data_for_testing
        try:
            ezdxf.options.write_fixed_meta_data_for_testing = True
            document = ezdxf.new("R2010", setup=False, units=units.MM)
            modelspace = document.modelspace()
            layers = {
                primitive["layer"]
                for group in ("boundaries", "rooms", "walls", "openings")
                for primitive in primitives[group]
            }
            for layer in sorted(layers):
                if layer not in document.layers:
                    document.layers.add(layer)
            for primitive in primitives["boundaries"]:
                modelspace.add_lwpolyline(
                    primitive["vertices_mm"], close=True,
                    dxfattribs={"layer": primitive["layer"]},
                )
            for primitive in primitives["rooms"]:
                modelspace.add_lwpolyline(
                    primitive["vertices_mm"], close=True,
                    dxfattribs={"layer": primitive["layer"]},
                )
            for group in ("walls", "openings"):
                for primitive in primitives[group]:
                    modelspace.add_line(
                        primitive["start_mm"], primitive["end_mm"],
                        dxfattribs={"layer": primitive["layer"]},
                    )
            output_path.parent.mkdir(parents=True, exist_ok=True)
            # ezdxf collects entity types in a set. Fixed metadata alone does not
            # stabilize CLASSES order between Python processes/hash seeds.
            document.classes.add_required_classes(document.dxfversion)
            document.classes.classes = dict(sorted(document.classes.classes.items()))
            document.saveas(output_path)
        finally:
            ezdxf.options.write_fixed_meta_data_for_testing = previous
    loaded = ezdxf.readfile(output_path)
    entities = list(loaded.modelspace())
    expected_polylines = len(primitives["boundaries"]) + len(primitives["rooms"])
    expected_lines = len(primitives["walls"]) + len(primitives["openings"])
    if loaded.dxfversion != "AC1024" or loaded.units != units.MM:
        raise ValueError("DXF round-trip changed version or units")
    if sum(entity.dxftype() == "LWPOLYLINE" for entity in entities) != expected_polylines:
        raise ValueError("DXF round-trip polyline count mismatch")
    if sum(entity.dxftype() == "LINE" for entity in entities) != expected_lines:
        raise ValueError("DXF round-trip line count mismatch")
    expected = [
        ("LWPOLYLINE", item["layer"], item["vertices_mm"])
        for group in ("boundaries", "rooms") for item in primitives[group]
    ] + [
        ("LINE", item["layer"], [item["start_mm"], item["end_mm"]])
        for group in ("walls", "openings") for item in primitives[group]
    ]
    actual: list[tuple[str, str, list[list[float]]]] = []
    for entity in entities:
        if entity.dxftype() == "LWPOLYLINE":
            coordinates = [[float(point[0]), float(point[1])] for point in entity.get_points()]
            if not entity.closed:
                raise ValueError("DXF round-trip opened a closed polyline")
        elif entity.dxftype() == "LINE":
            coordinates = [
                [float(entity.dxf.start.x), float(entity.dxf.start.y)],
                [float(entity.dxf.end.x), float(entity.dxf.end.y)],
            ]
        else:
            raise ValueError(f"DXF contains unsupported entity type {entity.dxftype()}")
        actual.append((entity.dxftype(), entity.dxf.layer, coordinates))
    if actual != [
        (entity_type, layer, [[float(x), float(y)] for x, y in coordinates])
        for entity_type, layer, coordinates in expected
    ]:
        raise ValueError("DXF round-trip entity layer or coordinates mismatch")


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


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> str:
    encoded = b"".join(_json_bytes(value, pretty=False) for value in values)
    path.write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _artifact(path: str, sha256: str, **details: Any) -> dict[str, Any]:
    return {"path": path.replace("\\", "/"), "sha256": sha256, **details}


def _validate_graph_integrity(graph: dict[str, Any]) -> None:
    nodes = graph["nodes"]
    edges = graph["edges"]
    if graph["counts"] != {"nodes": len(nodes), "rooms": len(nodes) - 1, "edges": len(edges)}:
        raise ValueError("Graph counts do not match node and edge arrays")
    if [node["node_index"] for node in nodes] != list(range(len(nodes))):
        raise ValueError("Graph node indices must be contiguous")
    outside = nodes[0]
    if outside["kind"] != "outside" or outside["kind_id"] != 0 or outside["semantic"] != "none":
        raise ValueError("Graph node zero must be outside")
    for node in nodes[1:]:
        if node["kind"] != "room" or node["kind_id"] != 1:
            raise ValueError("Nonzero graph nodes must be rooms")
        if ROOM_SEMANTIC_IDS.get(node["semantic"]) != node["semantic_id"]:
            raise ValueError("Graph room semantic ID mismatch")
        if len(node["polygon_grid"]) < 3 or len(node["features"]) != 7:
            raise ValueError("Graph room geometry or feature vector is malformed")
    if [edge["edge_index"] for edge in edges] != list(range(len(edges))):
        raise ValueError("Graph edge indices must be contiguous")
    sort_keys = [(edge["source"], edge["target"], edge["opening_index"]) for edge in edges]
    if sort_keys != sorted(sort_keys) or len({edge["opening_index"] for edge in edges}) != len(edges):
        raise ValueError("Graph edges must be stably sorted and unique per opening")
    for edge in edges:
        if not (0 <= edge["source"] < edge["target"] < len(nodes)):
            raise ValueError("Graph edge references an invalid node pair")
        if OPENING_TYPE_IDS.get(edge["opening_type"]) != edge["opening_type_id"]:
            raise ValueError("Graph opening type ID mismatch")
        if edge["host_wall_type"] not in WALL_TYPE_IDS or edge["channels"] not in (
            [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1],
            [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1],
        ):
            raise ValueError("Graph edge vocabulary or channels are invalid")
        if edge["is_exterior"] != (edge["source"] == 0):
            raise ValueError("Graph exterior edge flag disagrees with outside node")


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


def _validate_cad_integrity(primitives: dict[str, Any]) -> None:
    groups = ("boundaries", "rooms", "walls", "openings")
    if primitives["counts"] != {name: len(primitives[name]) for name in groups}:
        raise ValueError("CAD counts do not match primitive arrays")
    ids = [item["primitive_id"] for group in groups for item in primitives[group]]
    if len(ids) != len(set(ids)):
        raise ValueError("CAD primitive IDs must be globally unique")
    for item in primitives["boundaries"]:
        if item["layer"] != CAD_LAYERS["boundary"] or len(item["vertices_mm"]) < 3:
            raise ValueError("CAD boundary is malformed")
    for item in primitives["rooms"]:
        if ROOM_SEMANTIC_IDS.get(item["semantic"]) != item["semantic_id"]:
            raise ValueError("CAD room semantic ID mismatch")
        if item["layer"] != f"ROOM_{item['semantic'].upper()}":
            raise ValueError("CAD room layer mismatch")
    for item in primitives["walls"]:
        if item["layer"] != CAD_LAYERS.get(f"wall_{item['wall_type']}"):
            raise ValueError("CAD wall layer mismatch")
        if item["start_mm"] == item["end_mm"]:
            raise ValueError("CAD wall must have nonzero length")
    wall_ids = {item["primitive_id"] for item in primitives["walls"]}
    for item in primitives["openings"]:
        if item["layer"] != CAD_LAYERS.get(f"opening_{item['opening_type']}"):
            raise ValueError("CAD opening layer mismatch")
        if item["host_wall_id"] not in wall_ids or item["start_mm"] == item["end_mm"]:
            raise ValueError("CAD opening host or segment is invalid")


def _build_modality_tree(modality: str, corpus: CleanedCorpus, root: Path) -> dict[str, Any]:
    vocabulary = multimodal_vocabulary()
    _write_json(_safe_output_path(root, "vocabulary.json"), vocabulary)
    manifest_records: list[dict[str, Any]] = []
    aggregate: list[dict[str, Any]] = []
    corpus_artifact_paths = ["vocabulary.json"]
    if modality == "graph":
        schema = graph_schema_document()
        _write_json(_safe_output_path(root, "graph.schema.json"), schema)
        corpus_artifact_paths.append("graph.schema.json")
        for record in corpus.records:
            graph = build_graph_record(record.canonical, record.training)
            validate_json_schema(graph, schema)
            _validate_graph_integrity(graph)
            filename = f"{record.building_id}.json"
            sha256 = _write_json(_safe_output_path(root, filename), graph)
            aggregate.append(graph)
            manifest_records.append(
                {
                    "building_id": record.building_id,
                    "record_id": record.record_id,
                    "artifacts": [_artifact(filename, sha256)],
                }
            )
        _write_jsonl(_safe_output_path(root, "graphs.jsonl"), aggregate)
        corpus_artifact_paths.append("graphs.jsonl")
    elif modality == "image":
        schema = image_schema_document()
        _write_json(_safe_output_path(root, "image.schema.json"), schema)
        corpus_artifact_paths.append("image.schema.json")
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
    elif modality == "cad":
        schema = cad_schema_document()
        _write_json(_safe_output_path(root, "cad.schema.json"), schema)
        corpus_artifact_paths.append("cad.schema.json")
        for record in corpus.records:
            primitives = build_cad_primitives(record.canonical)
            validate_json_schema(primitives, schema)
            _validate_cad_integrity(primitives)
            json_filename = f"{record.building_id}.json"
            dxf_filename = f"{record.building_id}.dxf"
            json_sha256 = _write_json(_safe_output_path(root, json_filename), primitives)
            write_dxf(primitives, _safe_output_path(root, dxf_filename))
            aggregate.append(primitives)
            manifest_records.append(
                {
                    "building_id": record.building_id,
                    "record_id": record.record_id,
                    "artifacts": [
                        _artifact(json_filename, json_sha256),
                        _artifact(
                            dxf_filename,
                            _sha256(_safe_output_path(root, dxf_filename)),
                            dxf_version="AC1024",
                            units="millimeters",
                        ),
                    ],
                }
            )
        _write_jsonl(_safe_output_path(root, "primitives.jsonl"), aggregate)
        corpus_artifact_paths.append("primitives.jsonl")
    else:
        raise ValueError(f"Unsupported modality: {modality}")
    return {
        "schema_version": "rural-model-ready-manifest/1.0.0",
        "modality": modality,
        "source_corpus_hash": corpus.corpus_hash,
        "source_manifest_schema_version": corpus.manifest["schema_version"],
        "vocabulary_schema_version": vocabulary["schema_version"],
        "record_count": len(manifest_records),
        "dependencies": {"Pillow": pillow_version, "ezdxf": package_version("ezdxf")},
        "corpus_artifacts": [
            _artifact(path, _sha256(_safe_output_path(root, path)))
            for path in sorted(corpus_artifact_paths)
        ],
        "records": manifest_records,
    }


def _paths_overlap(left: Path, right: Path) -> bool:
    left = left.resolve()
    right = right.resolve()
    try:
        left.relative_to(right)
        return True
    except ValueError:
        pass
    try:
        right.relative_to(left)
        return True
    except ValueError:
        return False


def _publish_staging(staging: Path, output_root: Path, *, force: bool) -> None:
    if not output_root.exists():
        os.replace(staging, output_root)
        return
    if not force:
        raise FileExistsError(f"Output already exists: {output_root}")
    backup = output_root.with_name(f".{output_root.name}.backup")
    if backup.exists():
        raise FileExistsError(f"Refusing replacement because backup already exists: {backup}")
    marker = output_root / _PUBLICATION_MARKER
    if marker.exists():
        raise FileExistsError(f"Refusing replacement because transaction marker exists: {marker}")
    _write_json(
        marker,
        {
            "schema_version": _PUBLICATION_MARKER_SCHEMA,
            "output_root": str(output_root.resolve()),
        },
    )
    try:
        os.replace(output_root, backup)
    except BaseException:
        marker.unlink(missing_ok=True)
        raise
    try:
        os.replace(staging, output_root)
    except BaseException:
        os.replace(backup, output_root)
        (output_root / _PUBLICATION_MARKER).unlink(missing_ok=True)
        raise
    try:
        shutil.rmtree(backup)
    except OSError:
        # The new corpus is already committed. A later run will retry cleanup.
        pass


def _recover_publication(output_root: Path) -> None:
    """Reconcile the fixed backup left by an interrupted force publication."""

    backup = output_root.with_name(f".{output_root.name}.backup")
    output_marker = output_root / _PUBLICATION_MARKER
    if not backup.exists():
        if output_marker.exists():
            _validate_publication_marker(output_marker, output_root)
            output_marker.unlink()
        return
    _validate_publication_marker(backup / _PUBLICATION_MARKER, output_root)
    if not output_root.exists():
        os.replace(backup, output_root)
        (output_root / _PUBLICATION_MARKER).unlink()
        return
    try:
        shutil.rmtree(backup)
    except OSError as error:
        raise RuntimeError(f"Could not clean stale publication backup: {backup}") from error


def _validate_publication_marker(marker: Path, output_root: Path) -> None:
    try:
        value = json.loads(marker.read_bytes())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Refusing unauthenticated publication backup: {marker.parent}") from error
    expected = {
        "schema_version": _PUBLICATION_MARKER_SCHEMA,
        "output_root": str(output_root.resolve()),
    }
    if value != expected:
        raise RuntimeError(f"Refusing unauthenticated publication backup: {marker.parent}")


@contextmanager
def _publication_lock(output_root: Path):
    """Serialize recovery and publication for one absolute output identity."""

    identity = hashlib.sha256(str(output_root.resolve()).casefold().encode("utf-8")).hexdigest()
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        kernel32.ReleaseMutex.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel32.CreateMutexW(None, False, f"Local\\RuralDataPrep-{identity}")
        if not handle:
            raise OSError(ctypes.get_last_error(), "Could not create publication mutex")
        result = kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
        if result not in (0, 0x80):
            kernel32.CloseHandle(handle)
            raise OSError(ctypes.get_last_error(), "Could not acquire publication mutex")
        try:
            yield
        finally:
            kernel32.ReleaseMutex(handle)
            kernel32.CloseHandle(handle)
        return

    import fcntl

    lock_path = Path(tempfile.gettempdir()) / f"rural-data-prep-{identity}.lock"
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def convert_modality(
    modality: Literal["graph", "image", "cad"],
    input_root: Path,
    output_root: Path,
    *,
    force: bool = False,
    dry_run: bool = False,
) -> ConversionSummary:
    """Convert and atomically publish one complete training modality."""

    input_root = input_root.resolve()
    output_root = output_root.resolve()
    if _paths_overlap(input_root, output_root):
        raise ValueError("Input and output paths must not overlap")
    corpus = load_cleaned_corpus(input_root)
    if dry_run:
        with tempfile.TemporaryDirectory(prefix=f"rural-{modality}-dry-run-") as directory:
            staging = Path(directory)
            manifest = _build_modality_tree(modality, corpus, staging)
            _write_json(staging / "manifest.json", manifest)
            file_count = sum(path.is_file() for path in staging.rglob("*"))
        return ConversionSummary(
            modality=modality,
            source_corpus_hash=corpus.corpus_hash,
            record_count=len(corpus.records),
            output_root=output_root,
            dry_run=True,
            files_written=file_count,
        )
    output_root.parent.mkdir(parents=True, exist_ok=True)
    with _publication_lock(output_root):
        _recover_publication(output_root)
        if output_root.exists() and not force:
            raise FileExistsError(f"Output already exists: {output_root}")
        staging = Path(
            tempfile.mkdtemp(prefix=f".{output_root.name}.staging-", dir=output_root.parent)
        )
        try:
            manifest = _build_modality_tree(modality, corpus, staging)
            _write_json(staging / "manifest.json", manifest)
            file_count = sum(path.is_file() for path in staging.rglob("*"))
            _publish_staging(staging, output_root, force=force)
        except BaseException:
            if staging.exists():
                shutil.rmtree(staging)
            raise
    return ConversionSummary(
        modality=modality,
        source_corpus_hash=corpus.corpus_hash,
        record_count=len(corpus.records),
        output_root=output_root,
        dry_run=False,
        files_written=file_count,
    )


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


def _require_vocabulary(value: str, vocabulary: dict[str, int], *, field: str) -> int:
    try:
        return vocabulary[value]
    except KeyError as error:
        raise ValueError(f"Unknown {field}: {value}") from error


def _load_hashed_json(root: Path, relative_path: str, expected_sha256: str, *, label: str) -> dict[str, Any]:
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


def _safe_output_path(root: Path, *parts: str) -> Path:
    resolved_root = root.resolve()
    candidate = resolved_root.joinpath(*parts).resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(f"Output artifact escapes staging root: {candidate}") from error
    return candidate


def _recompute_cleaned_corpus_hash(manifest: dict[str, Any]) -> str:
    """Rebuild the cleaner's corpus identity from authenticated source lineage."""

    material = {
        "sources": [
            {
                "path": entry["source_relative_path"],
                "sha256": entry["source_sha256"],
            }
            for entry in manifest["records"]
        ],
        "rules": {
            "source": "*/draft/building.autosave.json",
            "repair": "near_axis_global_median_v1",
            "relation_inference": "host_wall_room_membership_v1",
            "explicit_relations_take_precedence": True,
            "max_short_axis_mm": 250,
            "min_aspect_ratio": 16,
            "grid_size": 256,
            "grid_padding": 8,
            "rounding": "half_up",
            "semantic_mapping": {
                "卧室": "bedroom",
                "客厅": "living_room",
                "厨房": "kitchen",
                "杂物间": "storage",
                "阳光房": "sunroom",
                "other": "unknown",
            },
            "public_schemas": schema_documents(),
        },
    }
    return hashlib.sha256(_json_bytes(material, pretty=False)).hexdigest()


def load_cleaned_corpus(input_root: Path) -> CleanedCorpus:
    """Load and authenticate every canonical/training pair from a cleaned manifest."""

    root = input_root.resolve()
    manifest = json.loads((root / "manifest.json").read_bytes())
    if not isinstance(manifest, dict):
        raise ValueError("Cleaned manifest must be a JSON object")
    schemas = schema_documents()
    validate_json_schema(manifest, schemas["manifest.schema.json"])
    for entry in manifest["records"]:
        _validate_building_id(str(entry["building_id"]))
    recomputed_corpus_hash = _recompute_cleaned_corpus_hash(manifest)
    if recomputed_corpus_hash != manifest["corpus_hash"]:
        raise ValueError("Cleaned manifest corpus_hash mismatch")
    records: list[CleanedRecord] = []
    building_ids: set[str] = set()
    record_ids: set[str] = set()
    for entry in manifest["records"]:
        building_id = str(entry["building_id"])
        record_id = str(entry["record_id"])
        _validate_building_id(building_id)
        if building_id in building_ids or record_id in record_ids:
            raise ValueError("Cleaned manifest contains duplicate building_id or record_id")
        canonical = _load_hashed_json(
            root,
            str(entry["canonical_file"]),
            str(entry["canonical_sha256"]),
            label="canonical",
        )
        training = _load_hashed_json(
            root,
            str(entry["training_file"]),
            str(entry["training_sha256"]),
            label="training",
        )
        validate_json_schema(canonical, schemas["canonical.schema.json"])
        validate_json_schema(training, schemas["training.schema.json"])
        if canonical.get("building_id") != building_id:
            raise ValueError(f"Canonical building_id mismatch for {building_id}")
        if canonical.get("record_id") != record_id or training.get("record_id") != record_id:
            raise ValueError(f"record_id mismatch for {building_id}")
        source = canonical.get("source", {})
        if (
            source.get("relative_path") != entry["source_relative_path"]
            or source.get("sha256") != entry["source_sha256"]
        ):
            raise ValueError(f"Canonical source lineage mismatch for {building_id}")
        records.append(
            CleanedRecord(
                building_id=building_id,
                record_id=record_id,
                canonical=canonical,
                training=training,
            )
        )
        building_ids.add(building_id)
        record_ids.add(record_id)
    if len(records) != int(manifest["building_count"]):
        raise ValueError("Cleaned manifest building_count does not match its records")
    return CleanedCorpus(
        input_root=root,
        corpus_hash=recomputed_corpus_hash,
        manifest=manifest,
        records=tuple(records),
    )


def build_graph_record(canonical: dict[str, Any], training: dict[str, Any]) -> dict[str, Any]:
    """Build one framework-neutral room graph from paired cleaned records."""

    if canonical.get("record_id") != training.get("record_id"):
        raise ValueError("Canonical and training record_id values do not match")
    grid_size = int(training["grid"]["size"])
    if grid_size != 256:
        raise ValueError(f"Unsupported training grid size: {grid_size}")
    rooms = sorted(training["rooms"], key=lambda room: int(room["index"]))
    total_area = sum(int(room["area_mm2"]) for room in rooms)
    if total_area <= 0:
        raise ValueError("Total room area must be positive")

    nodes: list[dict[str, Any]] = [
        {
            "node_index": 0,
            "kind": "outside",
            "kind_id": 0,
            "semantic": "none",
            "semantic_id": 0,
            "area_mm2": 0,
            "area_ratio": 0.0,
            "polygon_grid": [],
            "centroid_grid": None,
            "bbox_grid": None,
            "features": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        }
    ]
    for expected_index, room in enumerate(rooms):
        if int(room["index"]) != expected_index:
            raise ValueError("Room indices must be contiguous from zero")
        semantic = str(room["semantic"])
        semantic_id = _require_vocabulary(semantic, ROOM_SEMANTIC_IDS, field="room semantic")
        polygon = [[int(point[0]), int(point[1])] for point in room["polygon"]]
        xs = [point[0] for point in polygon]
        ys = [point[1] for point in polygon]
        bbox = [min(xs), min(ys), max(xs), max(ys)]
        centroid = _polygon_centroid(polygon)
        area_ratio = _rounded(int(room["area_mm2"]) / total_area)
        nodes.append(
            {
                "node_index": expected_index + 1,
                "kind": "room",
                "kind_id": 1,
                "semantic": semantic,
                "semantic_id": semantic_id,
                "area_mm2": int(room["area_mm2"]),
                "area_ratio": area_ratio,
                "polygon_grid": polygon,
                "centroid_grid": centroid,
                "bbox_grid": bbox,
                "features": [
                    1.0,
                    float(semantic_id),
                    area_ratio,
                    _rounded(centroid[0] / (grid_size - 1)),
                    _rounded(centroid[1] / (grid_size - 1)),
                    _rounded((bbox[2] - bbox[0]) / (grid_size - 1)),
                    _rounded((bbox[3] - bbox[1]) / (grid_size - 1)),
                ],
            }
        )

    openings = {int(item["index"]): item for item in training["openings"]}
    walls = {int(item["index"]): item for item in training["walls"]}
    edges: list[dict[str, Any]] = []
    for relation in training["relations"]:
        opening_index = int(relation["opening_index"])
        opening = openings.get(opening_index)
        if opening is None:
            raise ValueError(f"Relation references missing opening index {opening_index}")
        opening_type = str(opening["type"])
        opening_type_id = _require_vocabulary(
            opening_type, OPENING_TYPE_IDS, field="opening type"
        )
        host_wall = walls.get(int(opening["host_wall_index"]))
        if host_wall is None:
            raise ValueError(f"Opening {opening_index} references a missing host wall")
        host_wall_type = str(host_wall["wall_type"])
        _require_vocabulary(host_wall_type, WALL_TYPE_IDS, field="wall type")
        source = int(relation["source_room_index"]) + 1
        target_spec = relation["target"]
        target = 0 if target_spec["kind"] == "outside" else int(target_spec["room_index"]) + 1
        source, target = sorted((source, target))
        channels = relation["channels"]
        center = [int(opening["center"][0]), int(opening["center"][1])]
        edges.append(
            {
                "opening_index": opening_index,
                "source": source,
                "target": target,
                "relation_type": relation.get("relation_type"),
                "opening_type": opening_type,
                "opening_type_id": opening_type_id,
                "channels": [
                    int(channels.get("people") is True),
                    int(channels.get("air") is True),
                    int(channels.get("light") is True),
                ],
                "width_mm": opening.get("width_mm"),
                "height_mm": opening.get("height_mm"),
                "sill_height_mm": opening.get("sill_height_mm"),
                "center_grid": center,
                "center_normalized": [
                    _rounded(center[0] / (grid_size - 1)),
                    _rounded(center[1] / (grid_size - 1)),
                ],
                "host_wall_type": host_wall_type,
                "is_exterior": target_spec["kind"] == "outside",
            }
        )
    edges.sort(key=lambda edge: (edge["source"], edge["target"], edge["opening_index"]))
    for edge_index, edge in enumerate(edges):
        edge["edge_index"] = edge_index

    return {
        "schema_version": GRAPH_SCHEMA_VERSION,
        "record_id": str(training["record_id"]),
        "building_id": str(canonical["building_id"]),
        "conditions": copy.deepcopy(training["conditions"]),
        "grid": copy.deepcopy(training["grid"]),
        "nodes": nodes,
        "edges": edges,
        "counts": {"nodes": len(nodes), "rooms": len(rooms), "edges": len(edges)},
    }
