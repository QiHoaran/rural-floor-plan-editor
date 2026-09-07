"""Build canonical, training, and household records from one source document."""

from __future__ import annotations

import copy
import math
from collections import Counter
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from .discovery import BuildingSource
from .geometry import (
    derive_polygon,
    repair_near_axis_geometry,
    round_half_up,
    validate_geometry,
    wall_length_mm,
)
from .projection import GridTransform, normalize_polygon
from .semantics import normalize_room_semantic
from .survey import record_id_for, split_survey


CANONICAL_SCHEMA_VERSION = "rural-clean-canonical/1.0.0"
TRAINING_SCHEMA_VERSION = "rural-floorplan-training/1.0.0"
HOUSEHOLD_SCHEMA_VERSION = "rural-household-sidecar/1.0.0"

KNOWN_TOP_LEVEL_FIELDS = {
    "schema_version",
    "building_id",
    "metadata",
    "survey",
    "site",
    "workflow",
    "coordinate_system",
    "building_defaults",
    "reference_image",
    "reference_calibration",
    "statistics",
    "structured_validation",
    "validation",
    "floors",
    "vertices",
    "walls",
    "wall_elements",
    "faces",
    "outside_regions",
    "relations",
    "custom_function_types",
}


@dataclass(frozen=True)
class CleanedBuilding:
    canonical: dict[str, Any]
    training: dict[str, Any]
    household: dict[str, Any]
    metrics: dict[str, Any]


def _mapping(document: dict[str, Any], field: str) -> dict[str, dict[str, Any]]:
    value = document.get(field, {})
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    if not all(isinstance(key, str) and isinstance(item, dict) for key, item in value.items()):
        raise ValueError(f"{field} must map string IDs to objects")
    return value


def _list(document: dict[str, Any], field: str) -> list[Any]:
    value = document.get(field, [])
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    return value


def _validate_references(
    document: dict[str, Any],
    vertices: dict[str, dict[str, Any]],
    walls: dict[str, dict[str, Any]],
    elements: dict[str, dict[str, Any]],
    faces: dict[str, dict[str, Any]],
) -> None:
    issues = validate_geometry(vertices, walls, faces)
    for element_id in sorted(elements):
        element = elements[element_id]
        host = element.get("host_wall_id")
        if host not in walls:
            issues.append(f"Wall element {element_id} references a missing host wall")
            continue
        try:
            offset = float(element.get("offset_from_start_mm", 0))
            width = float(element.get("width_mm", 0))
        except (TypeError, ValueError):
            issues.append(f"Wall element {element_id} has invalid placement values")
            continue
        if offset < 0 or width <= 0 or offset + width > wall_length_mm(walls[host], vertices) + 1e-6:
            issues.append(f"Wall element {element_id} falls outside host wall {host}")
    for index, relation in enumerate(_list(document, "relations")):
        if not isinstance(relation, dict):
            issues.append(f"Relation {index} must be an object")
            continue
        element_id = relation.get("wall_element_id")
        if element_id not in elements:
            issues.append(f"Relation {index} references a missing wall element")
        from_face_id = relation.get("from_face_id")
        if from_face_id not in faces:
            issues.append(f"Relation {index} references a missing from face")
        target = relation.get("to")
        if not isinstance(target, dict) or target.get("kind") not in {"outside", "face"}:
            issues.append(f"Relation {index} has an invalid target")
        elif target.get("kind") == "face" and target.get("face_id") not in faces:
            issues.append(f"Relation {index} references a missing target face")
        if element_id in elements and elements[element_id].get("host_wall_id") in walls:
            wall = walls[elements[element_id]["host_wall_id"]]
            endpoints = {wall.get("start_vertex_id"), wall.get("end_vertex_id")}
            containing_faces = {
                face_id
                for face_id, face in faces.items()
                if endpoints <= set(face.get("boundary_vertex_ids", []))
                and _wall_on_face_boundary(wall, face, vertices)
            }
            if from_face_id in faces and from_face_id not in containing_faces:
                issues.append(f"Relation {index} host wall is not on from face {from_face_id}")
            if isinstance(target, dict) and target.get("kind") == "face":
                target_face_id = target.get("face_id")
                if target_face_id == from_face_id:
                    issues.append(f"Relation {index} connects a face to itself")
                if target_face_id in faces and target_face_id not in containing_faces:
                    issues.append(f"Relation {index} host wall is not on target face {target_face_id}")
            elif isinstance(target, dict) and target.get("kind") == "outside" and len(containing_faces) != 1:
                issues.append(f"Relation {index} outside opening is not on a single exterior room boundary")
    for floor_index, floor in enumerate(_list(document, "floors")):
        if not isinstance(floor, dict):
            issues.append(f"Floor {floor_index} must be an object")
            continue
        if any(wall_id not in walls for wall_id in floor.get("wall_ids", [])):
            issues.append(f"Floor {floor_index} references a missing wall")
        if any(face_id not in faces for face_id in floor.get("face_ids", [])):
            issues.append(f"Floor {floor_index} references a missing face")
    if issues:
        raise ValueError("; ".join(sorted(issues)))


def _wall_on_face_boundary(
    wall: dict[str, Any],
    face: dict[str, Any],
    vertices: dict[str, dict[str, Any]],
) -> bool:
    """Return whether collinear face edges continuously cover the host wall segment."""

    start = vertices[wall["start_vertex_id"]]
    end = vertices[wall["end_vertex_id"]]
    ax, ay = int(start["x_mm"]), int(start["y_mm"])
    bx, by = int(end["x_mm"]), int(end["y_mm"])
    dx, dy = bx - ax, by - ay
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return False
    ids = face.get("boundary_vertex_ids", [])
    intervals: list[tuple[float, float]] = []
    for index, first_id in enumerate(ids):
        second_id = ids[(index + 1) % len(ids)]
        first = vertices[first_id]
        second = vertices[second_id]
        points = (
            (int(first["x_mm"]), int(first["y_mm"])),
            (int(second["x_mm"]), int(second["y_mm"])),
        )
        if any(dx * (y - ay) - dy * (x - ax) != 0 for x, y in points):
            continue
        parameters = [((x - ax) * dx + (y - ay) * dy) / length_squared for x, y in points]
        low = max(0.0, min(parameters))
        high = min(1.0, max(parameters))
        if high > low:
            intervals.append((low, high))
    covered_to = 0.0
    for low, high in sorted(intervals):
        if low > covered_to + 1e-9:
            break
        covered_to = max(covered_to, high)
    return covered_to >= 1.0 - 1e-9


def _complete_opening_relations(
    vertices: dict[str, dict[str, Any]],
    walls: dict[str, dict[str, Any]],
    elements: dict[str, dict[str, Any]],
    faces: dict[str, dict[str, Any]],
    explicit_relations: list[Any],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Infer only missing opening relations from the repaired host-wall geometry."""

    normalized_elements = copy.deepcopy(elements)
    relations = copy.deepcopy(explicit_relations)
    explicitly_related = {
        relation.get("wall_element_id")
        for relation in explicit_relations
        if isinstance(relation, dict)
    }
    repairs: list[dict[str, Any]] = []
    for element_id in sorted(normalized_elements):
        if element_id in explicitly_related:
            continue
        element = normalized_elements[element_id]
        host_wall_id = element["host_wall_id"]
        wall = walls[host_wall_id]
        matched_face_ids = sorted(
            face_id
            for face_id, face in faces.items()
            if _wall_on_face_boundary(wall, face, vertices)
        )
        if len(matched_face_ids) not in {1, 2}:
            raise ValueError(
                f"Wall element {element_id} on host wall {host_wall_id} matches "
                f"{len(matched_face_ids)} room boundaries; relation cannot be inferred"
            )

        source_type = str(element.get("element_type", ""))
        normalized_type = source_type
        if source_type in {"interior_door", "exterior_door"}:
            normalized_type = "exterior_door" if len(matched_face_ids) == 1 else "interior_door"
        elif source_type in {"interior_window", "exterior_window"}:
            normalized_type = source_type
        elif source_type == "passage" and len(matched_face_ids) == 1:
            raise ValueError(
                f"Passage {element_id} on host wall {host_wall_id} cannot be inferred to outside"
            )

        if normalized_type != source_type:
            element["source_element_type"] = source_type
            element["element_type"] = normalized_type

        is_window = normalized_type in {"interior_window", "exterior_window"}
        channels = (
            {"people": False, "air": True, "light": True}
            if is_window
            else {
                "people": True,
                "air": True,
                "light": normalized_type == "exterior_door" and len(matched_face_ids) == 1,
            }
        )
        target = (
            {"kind": "outside"}
            if len(matched_face_ids) == 1
            else {"kind": "face", "face_id": matched_face_ids[1]}
        )
        relation = {
            "relation_type": "opening",
            "wall_element_id": element_id,
            "from_face_id": matched_face_ids[0],
            "to": target,
            "channels": channels,
        }
        relations.append(relation)
        repairs.append(
            {
                "reason": "missing_relation",
                "wall_element_id": element_id,
                "host_wall_id": host_wall_id,
                "matched_face_ids": matched_face_ids,
                "source_element_type": source_type,
                "normalized_element_type": normalized_type,
                "inferred_relation": copy.deepcopy(relation),
            }
        )
    return normalized_elements, relations, repairs


def _point_on_segment(
    point: tuple[int, int], start: tuple[int, int], end: tuple[int, int]
) -> bool:
    cross = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
    return cross == 0 and min(start[0], end[0]) <= point[0] <= max(start[0], end[0]) and min(start[1], end[1]) <= point[1] <= max(start[1], end[1])


def _segment_parameter(
    point: tuple[int, int], start: tuple[int, int], end: tuple[int, int]
) -> tuple[int, int]:
    if abs(end[0] - start[0]) >= abs(end[1] - start[1]):
        return (point[0] - start[0]) * (1 if end[0] >= start[0] else -1), point[1]
    return (point[1] - start[1]) * (1 if end[1] >= start[1] else -1), point[0]


def occupied_boundary_components(
    faces: dict[str, dict[str, Any]], vertices: dict[str, dict[str, Any]]
) -> list[list[list[int]]]:
    """Union face polygons by splitting and cancelling shared boundary segments."""

    face_points: list[list[tuple[int, int]]] = []
    all_points: set[tuple[int, int]] = set()
    for face_id in sorted(faces):
        ids = faces[face_id].get("boundary_vertex_ids", [])
        points = [(int(vertices[vertex_id]["x_mm"]), int(vertices[vertex_id]["y_mm"])) for vertex_id in ids]
        face_points.append(points)
        all_points.update(points)
    segment_counts: Counter[tuple[tuple[int, int], tuple[int, int]]] = Counter()
    for polygon in face_points:
        for index, start in enumerate(polygon):
            end = polygon[(index + 1) % len(polygon)]
            split_points = sorted(
                (point for point in all_points if _point_on_segment(point, start, end)),
                key=lambda point: _segment_parameter(point, start, end),
            )
            for first, second in zip(split_points, split_points[1:]):
                if first == second:
                    continue
                segment_counts[tuple(sorted((first, second)))] += 1
    boundary_edges = {edge for edge, count in segment_counts.items() if count == 1}
    adjacency: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for first, second in boundary_edges:
        adjacency.setdefault(first, []).append(second)
        adjacency.setdefault(second, []).append(first)
    invalid_nodes = [point for point, neighbors in adjacency.items() if len(neighbors) != 2]
    if invalid_nodes:
        raise ValueError(f"Occupied boundary is not a set of closed loops at {sorted(invalid_nodes)[:5]}")

    remaining = set(boundary_edges)
    loops: list[list[list[int]]] = []
    while remaining:
        edge = min(remaining)
        start, current = edge
        previous = start
        points = [start]
        while True:
            points.append(current)
            remaining.discard(tuple(sorted((previous, current))))
            candidates = sorted(point for point in adjacency[current] if point != previous)
            if not candidates:
                raise ValueError("Occupied boundary loop terminated early")
            next_point = candidates[0]
            if next_point == start:
                remaining.discard(tuple(sorted((current, start))))
                break
            previous, current = current, next_point
            if len(points) > len(boundary_edges) + 1:
                raise ValueError("Occupied boundary loop did not close")
        loops.append(normalize_polygon(points))
    return sorted(loops, key=lambda polygon: (-abs(_area2(polygon)), polygon))


def _area2(points: Sequence[Sequence[int]]) -> int:
    return sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )


def _opening_geometry(
    element: dict[str, Any], wall: dict[str, Any], vertices: dict[str, dict[str, Any]]
) -> tuple[list[list[int]], list[int]]:
    start = vertices[wall["start_vertex_id"]]
    end = vertices[wall["end_vertex_id"]]
    dx = int(end["x_mm"]) - int(start["x_mm"])
    dy = int(end["y_mm"]) - int(start["y_mm"])
    length = math.hypot(dx, dy)
    unit_x, unit_y = dx / length, dy / length
    offset = float(element["offset_from_start_mm"])
    width = float(element["width_mm"])
    first = [round_half_up(int(start["x_mm"]) + unit_x * offset), round_half_up(int(start["y_mm"]) + unit_y * offset)]
    second = [round_half_up(int(start["x_mm"]) + unit_x * (offset + width)), round_half_up(int(start["y_mm"]) + unit_y * (offset + width))]
    center = [round_half_up((first[0] + second[0]) / 2), round_half_up((first[1] + second[1]) / 2)]
    return [first, second], center


def _wall_direction(wall: dict[str, Any], vertices: dict[str, dict[str, Any]]) -> str:
    start = vertices[wall["start_vertex_id"]]
    end = vertices[wall["end_vertex_id"]]
    dx = int(end["x_mm"]) - int(start["x_mm"])
    dy = int(end["y_mm"]) - int(start["y_mm"])
    if dy == 0:
        return "east" if dx > 0 else "west"
    if dx == 0:
        return "north" if dy > 0 else "south"
    return "diagonal"


def build_records(source: BuildingSource) -> CleanedBuilding:
    document = copy.deepcopy(source.document)
    vertices = _mapping(document, "vertices")
    walls = _mapping(document, "walls")
    elements = _mapping(document, "wall_elements")
    faces = _mapping(document, "faces")
    outside_regions = _mapping(document, "outside_regions")
    repair = repair_near_axis_geometry(vertices, walls)
    repaired_vertices = repair.vertices
    _validate_references(document, repaired_vertices, walls, elements, faces)
    normalized_elements, completed_relations, relation_repairs = _complete_opening_relations(
        repaired_vertices,
        walls,
        elements,
        faces,
        _list(document, "relations"),
    )

    record_id = record_id_for(source.building_id)
    architectural, household_values, survey_extensions = split_survey(document.get("survey"))

    rooms: list[dict[str, Any]] = []
    for face_id in sorted(faces):
        face = faces[face_id]
        ids = list(face["boundary_vertex_ids"])
        derived = derive_polygon(ids, repaired_vertices)
        rooms.append(
            {
                "id": face_id,
                "boundary_vertex_ids": ids,
                "polygon_mm": [[int(repaired_vertices[vertex_id]["x_mm"]), int(repaired_vertices[vertex_id]["y_mm"])] for vertex_id in ids],
                "semantic": normalize_room_semantic(face.get("function_code"), face.get("display_name")),
                "original_function_code": face.get("function_code"),
                "display_name": face.get("display_name", ""),
                "source_area_mm2": face.get("area_mm2"),
                "area_mm2": derived["area_mm2"],
                "bbox_mm": derived["bbox_mm"],
                "centroid_mm": derived["centroid_mm"],
                "properties": {key: value for key, value in face.items() if key not in {"boundary_vertex_ids", "function_code", "display_name", "area_mm2"}},
            }
        )

    canonical_walls: list[dict[str, Any]] = []
    for wall_id in sorted(walls):
        wall = walls[wall_id]
        canonical_walls.append(
            {
                "id": wall_id,
                **copy.deepcopy(wall),
                "length_mm": round_half_up(wall_length_mm(wall, repaired_vertices)),
                "direction": _wall_direction(wall, repaired_vertices),
            }
        )

    canonical_elements: list[dict[str, Any]] = []
    element_geometry: dict[str, tuple[list[list[int]], list[int]]] = {}
    for element_id in sorted(normalized_elements):
        element = normalized_elements[element_id]
        wall = walls[element["host_wall_id"]]
        segment, center = _opening_geometry(element, wall, repaired_vertices)
        element_geometry[element_id] = (segment, center)
        canonical_elements.append(
            {"id": element_id, **copy.deepcopy(element), "segment_mm": segment, "center_mm": center}
        )

    boundary_components = occupied_boundary_components(faces, repaired_vertices)
    vertex_values = list(repaired_vertices.values())
    building_bbox = [
        min(int(vertex["x_mm"]) for vertex in vertex_values),
        min(int(vertex["y_mm"]) for vertex in vertex_values),
        max(int(vertex["x_mm"]) for vertex in vertex_values),
        max(int(vertex["y_mm"]) for vertex in vertex_values),
    ]
    derived_relations: list[dict[str, Any]] = []
    for relation in completed_relations:
        edge = {
            "from_face_id": relation["from_face_id"],
            "to": copy.deepcopy(relation["to"]),
            "wall_element_id": relation["wall_element_id"],
            "relation_type": relation.get("relation_type"),
            "channels": copy.deepcopy(relation.get("channels", {})),
        }
        derived_relations.append(edge)
    derived_relations.sort(
        key=lambda edge: (
            edge["from_face_id"],
            edge["to"].get("kind", ""),
            edge["to"].get("face_id", ""),
            edge["wall_element_id"],
        )
    )
    room_adjacency = [edge for edge in derived_relations if edge["to"].get("kind") == "face"]
    outdoor_connections = [edge for edge in derived_relations if edge["to"].get("kind") == "outside"]
    channel_edges = {
        channel: [
            {
                "from_face_id": edge["from_face_id"],
                "to": edge["to"],
                "wall_element_id": edge["wall_element_id"],
            }
            for edge in derived_relations
            if edge["channels"].get(channel) is True
        ]
        for channel in ("people", "air", "light")
    }
    top_extensions = {key: copy.deepcopy(value) for key, value in document.items() if key not in KNOWN_TOP_LEVEL_FIELDS}
    canonical = {
        "schema_version": CANONICAL_SCHEMA_VERSION,
        "record_id": record_id,
        "building_id": source.building_id,
        "source": {
            "relative_path": source.relative_path,
            "sha256": source.sha256,
            "input_schema_version": document.get("schema_version"),
            "workflow_status": document.get("workflow", {}).get("status") if isinstance(document.get("workflow"), dict) else None,
        },
        "metadata": copy.deepcopy(document.get("metadata", {})),
        "workflow": copy.deepcopy(document.get("workflow", {})),
        "site": copy.deepcopy(document.get("site", {})),
        "coordinate_system": copy.deepcopy(document.get("coordinate_system", {})),
        "building_defaults": copy.deepcopy(document.get("building_defaults", {})),
        "reference_image": copy.deepcopy(document.get("reference_image", {})),
        "reference_calibration": copy.deepcopy(document.get("reference_calibration")),
        "architectural_survey": architectural,
        "survey_extensions": survey_extensions,
        "vertices": {key: repaired_vertices[key] for key in sorted(repaired_vertices)},
        "walls": canonical_walls,
        "wall_elements": canonical_elements,
        "rooms": rooms,
        "outside_regions": [{"id": key, **copy.deepcopy(outside_regions[key])} for key in sorted(outside_regions)],
        "relations": copy.deepcopy(completed_relations),
        "floors": copy.deepcopy(_list(document, "floors")),
        "custom_function_types": copy.deepcopy(_list(document, "custom_function_types")),
        "source_validation": {
            "legacy": copy.deepcopy(document.get("validation", {})),
            "structured": copy.deepcopy(document.get("structured_validation", [])),
        },
        "source_extensions": top_extensions,
        "derived": {
            "building_bbox_mm": building_bbox,
            "total_room_area_mm2": sum(room["area_mm2"] for room in rooms),
            "occupied_boundary_components_mm": boundary_components,
            "room_adjacency": room_adjacency,
            "outdoor_connections": outdoor_connections,
            "channel_edges": channel_edges,
        },
        "repairs": {
            "rule_version": "near_axis_global_median_v1",
            "max_short_axis_mm": 250,
            "min_aspect_ratio": 16,
            "repaired_wall_ids": repair.repaired_wall_ids,
            "vertices": repair.repairs,
            "relations": relation_repairs,
        },
    }

    north_angle = document.get("site", {}).get("north_angle_deg", 0) if isinstance(document.get("site"), dict) else 0
    transform = GridTransform.from_vertices(repaired_vertices, north_angle_deg=float(north_angle or 0))
    def room_position(room: dict[str, Any]) -> tuple[float, float, str]:
        grid_x, grid_y = transform.forward_float(room["centroid_mm"])
        return -grid_y, grid_x, room["id"]

    room_order = sorted(rooms, key=room_position)
    room_index = {room["id"]: index for index, room in enumerate(room_order)}
    training_rooms = []
    for index, room in enumerate(room_order):
        polygon = normalize_polygon(transform.forward(point) for point in room["polygon_mm"])
        if len({tuple(point) for point in polygon}) != len(polygon):
            raise ValueError(f"Room {room['id']} collapses on the training grid")
        training_rooms.append(
            {
                "index": index,
                "semantic": room["semantic"],
                "polygon": polygon,
                "area_mm2": room["area_mm2"],
                "bbox_mm": room["bbox_mm"],
            }
        )

    wall_candidates: list[tuple[tuple[Any, ...], str, dict[str, Any]]] = []
    for wall_id, wall in walls.items():
        start = transform.forward(repaired_vertices[wall["start_vertex_id"]])
        end = transform.forward(repaired_vertices[wall["end_vertex_id"]])
        normalized_segment = sorted((start, end))
        midpoint = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        key = (midpoint[1], midpoint[0], normalized_segment, wall_id)
        wall_candidates.append((key, wall_id, {"segment": normalized_segment, **{key: copy.deepcopy(value) for key, value in wall.items() if key not in {"start_vertex_id", "end_vertex_id"}}}))
    wall_candidates.sort(key=lambda item: item[0])
    wall_index = {wall_id: index for index, (_, wall_id, _) in enumerate(wall_candidates)}
    training_walls = [{"index": index, **record} for index, (_, _, record) in enumerate(wall_candidates)]

    opening_candidates: list[tuple[tuple[Any, ...], str, dict[str, Any]]] = []
    for element_id, element in normalized_elements.items():
        segment_mm, center_mm = element_geometry[element_id]
        segment = sorted(transform.forward(point) for point in segment_mm)
        center = transform.forward(center_mm)
        key = (center[1], center[0], element.get("element_type", ""), segment, element_id)
        record = {
            "type": element.get("element_type"),
            "host_wall_index": wall_index[element["host_wall_id"]],
            "segment": segment,
            "center": center,
            "width_mm": element.get("width_mm"),
            "height_mm": element.get("height_mm"),
            "sill_height_mm": element.get("sill_height_mm"),
        }
        opening_candidates.append((key, element_id, record))
    opening_candidates.sort(key=lambda item: item[0])
    opening_index = {element_id: index for index, (_, element_id, _) in enumerate(opening_candidates)}
    training_openings = [{"index": index, **record} for index, (_, _, record) in enumerate(opening_candidates)]

    training_relations = []
    for relation in completed_relations:
        target = relation["to"]
        normalized_target = {"kind": "outside"} if target["kind"] == "outside" else {"kind": "room", "room_index": room_index[target["face_id"]]}
        training_relations.append(
            {
                "opening_index": opening_index[relation["wall_element_id"]],
                "source_room_index": room_index[relation["from_face_id"]],
                "target": normalized_target,
                "relation_type": relation.get("relation_type"),
                "channels": copy.deepcopy(relation.get("channels", {})),
            }
        )
    training_relations.sort(key=lambda relation: (relation["source_room_index"], str(relation["target"]), relation["opening_index"]))
    projected_boundaries = [normalize_polygon(transform.forward(point) for point in component) for component in boundary_components]
    training = {
        "schema_version": TRAINING_SCHEMA_VERSION,
        "record_id": record_id,
        "conditions": architectural,
        "grid": {"size": 256, "padding": 8, "north_is_positive_y": True, "transform": transform.as_dict()},
        "boundary_components": projected_boundaries,
        "rooms": training_rooms,
        "walls": training_walls,
        "openings": training_openings,
        "relations": training_relations,
        "counts": {
            "vertices": len(repaired_vertices),
            "walls": len(walls),
            "rooms": len(faces),
            "wall_elements": len(normalized_elements),
            "relations": len(completed_relations),
        },
    }
    household = {"schema_version": HOUSEHOLD_SCHEMA_VERSION, "record_id": record_id, **household_values}
    grid_quantization_errors = []
    for vertex in repaired_vertices.values():
        original = (float(vertex["x_mm"]), float(vertex["y_mm"]))
        restored = transform.inverse(transform.forward(vertex))
        grid_quantization_errors.append(math.hypot(restored[0] - original[0], restored[1] - original[1]))
    metrics = {
        "building_id": source.building_id,
        "record_id": record_id,
        "workflow_status": canonical["source"]["workflow_status"],
        "input_schema_version": canonical["source"]["input_schema_version"],
        "plan_form": architectural.get("plan_form"),
        "room_semantics": Counter(room["semantic"] for room in rooms),
        "counts": training["counts"],
        "repaired_wall_count": len(repair.repaired_wall_ids),
        "moved_vertex_count": len(repair.repairs),
        "inferred_relation_count": len(relation_repairs),
        "normalized_opening_type_count": sum(
            item["source_element_type"] != item["normalized_element_type"]
            for item in relation_repairs
        ),
        "source_area_mismatch_count": sum(
            isinstance(face.get("area_mm2"), (int, float))
            and not isinstance(face.get("area_mm2"), bool)
            and face.get("area_mm2")
            != derive_polygon(face["boundary_vertex_ids"], vertices)["area_mm2"]
            for face in faces.values()
        ),
        "maximum_single_axis_delta_mm": max(
            (abs(delta) for item in repair.repairs for delta in item["delta_mm"]),
            default=0,
        ),
        "wall_type_counts": dict(sorted(Counter(str(wall.get("wall_type", "unknown")) for wall in walls.values()).items())),
        "opening_type_counts": dict(sorted(Counter(str(element.get("element_type", "unknown")) for element in normalized_elements.values()).items())),
        "building_dimensions_mm": {
            "width": building_bbox[2] - building_bbox[0],
            "height": building_bbox[3] - building_bbox[1],
        },
        "wall_thicknesses_mm": [wall.get("thickness_mm") for wall in walls.values()],
        "wall_heights_mm": [wall.get("height_mm") for wall in walls.values()],
        "opening_widths_mm": [element.get("width_mm") for element in normalized_elements.values()],
        "opening_heights_mm": [element.get("height_mm") for element in normalized_elements.values()],
        "grid_quantization_max_error_mm": max(grid_quantization_errors, default=0.0),
    }
    return CleanedBuilding(canonical=canonical, training=training, household=household, metrics=metrics)
