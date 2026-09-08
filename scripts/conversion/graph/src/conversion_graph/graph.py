"""Deterministic framework-neutral room graph for cleaned floor plans."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from conversion_shared.corpus import CleanedCorpus
from conversion_shared.io import _artifact, _safe_output_path, _write_json, _write_jsonl
from conversion_shared.schema_helpers import _closed_object, _nullable, _point_schema
from conversion_shared.schemas import validate_json_schema
from conversion_shared.vocabulary import (
    OPENING_TYPE_IDS,
    ROOM_SEMANTIC_IDS,
    WALL_TYPE_IDS,
    _polygon_centroid,
    _require_vocabulary,
    _rounded,
)

GRAPH_SCHEMA_VERSION = "rural-training-graph/1.0.0"


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


def build_tree(
    corpus: CleanedCorpus, root: Path
) -> tuple[list[dict[str, Any]], list[str]]:
    """Write graph artifacts and return per-record manifests and corpus artifact paths."""

    schema = graph_schema_document()
    _write_json(_safe_output_path(root, "graph.schema.json"), schema)
    manifest_records: list[dict[str, Any]] = []
    aggregate: list[dict[str, Any]] = []
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
    return manifest_records, ["graph.schema.json", "graphs.jsonl"]
