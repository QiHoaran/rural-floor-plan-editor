"""Deterministic millimetre vector primitives and DXF export for cleaned floor plans."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from conversion_shared.corpus import CleanedCorpus
from conversion_shared.io import _artifact, _safe_output_path, _sha256, _write_json, _write_jsonl
from conversion_shared.schema_helpers import _closed_object, _nullable, _point_schema
from conversion_shared.schemas import validate_json_schema
from conversion_shared.vocabulary import (
    CAD_LAYERS,
    OPENING_TYPE_IDS,
    ROOM_SEMANTIC_IDS,
    WALL_TYPE_IDS,
    _require_vocabulary,
)

_EZDXF_WRITE_LOCK = threading.Lock()


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


def build_tree(
    corpus: CleanedCorpus, root: Path
) -> tuple[list[dict[str, Any]], list[str]]:
    """Write CAD artifacts and return per-record manifests and corpus artifact paths."""

    schema = cad_schema_document()
    _write_json(_safe_output_path(root, "cad.schema.json"), schema)
    manifest_records: list[dict[str, Any]] = []
    aggregate: list[dict[str, Any]] = []
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
    return manifest_records, ["cad.schema.json", "primitives.jsonl"]
