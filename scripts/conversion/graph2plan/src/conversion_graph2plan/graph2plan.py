"""Convert one cleaned canonical building into a Graph2Plan training record.

Field-by-field the record follows ``Network/model/floorplan.py`` (the loader) and
``DataPreparation/2.data_train_converted.py`` (the field list), not the README:

===========  =========================================================================
field        consumed by
===========  =========================================================================
name         ``FloorPlanDataset`` output key and ``train.txt``/``test.txt``
boundary     ``get_input_boundary``, ``get_inside_box``, ``get_boxes``,
             ``get_layout_image``, ``get_inside_coords``, ``FloorPlan._get_rot``
rType        ``get_rooms`` and ``np.concatenate([gtBoxNew, rType[:,None]])``
gtBoxNew     ``get_attributes``, ``get_boxes``, ``get_triples``, ``get_layout_image``
rEdge        ``get_triples`` (only columns 0 and 1 are read)
order        ``get_layout_image``; 1-based, so ``order-1`` indexes rooms
gtBox        not read by ``Network``; kept because the format defines it
rBoundary    not read by ``Network``; read by ``PostProcess/g2p``
===========  =========================================================================

Four details are easy to get wrong, so each is handled explicitly:

1. ``order`` is MATLAB 1-based -- ``get_layout_image`` subtracts one.
2. ``boundary[:2]`` must be the two endpoints of the front door, so the envelope
   polygon is rotated to start at the door.
3. Coordinates are RPLAN image coordinates (y down) on a 256 grid; the shared grid
   is north-up, so y is mirrored and ``dir`` keeps its documented meaning.
4. ``rEdge`` is the cleaner's existing door-mediated room-room graph, reused as-is.
   Upstream RPLAN derives it from bbox collision instead; both edge sets are
   computed and the difference is reported rather than silently swapped.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from conversion_shared.projection import GridTransform, normalize_polygon

from .vocabulary import (
    ENTRANCE_HOST_PRIORITY,
    INSIDE_PREDICATE,
    PREDICATES,
    ROOM_LABEL,
    ROOM_LABEL_MAX,
    SURROUNDING_PREDICATE,
    room_type,
)

# collide2d() tolerance from RPLAN-Toolbox get_edges(). It is expressed in the same
# 256-pixel space this converter projects into, so it transfers unchanged.
BBOX_COLLISION_TOLERANCE = 9

GRID_SIZE = 256
GRID_PADDING = 8

RECORD_SCHEMA_VERSION = "graph2plan-record/1.0.0"
MAPPING_SCHEMA_VERSION = "graph2plan-source-mapping/1.0.0"

# Single edges require the documented loader fix restoring squeezed (3,) to (1, 3).
# Empty graphs remain unsupported; never pad a graph with fabricated edges.
MINIMUM_EDGE_COUNT = 1

MAT_FIELDS = ("name", "boundary", "rType", "gtBoxNew", "gtBox", "rEdge", "order", "rBoundary")

# Conditions where the *building* cannot be expressed in Graph2Plan's single-boundary,
# single-front-door, 13-class format. They are per-sample data limitations and are
# quarantined, not treated as converter defects.
QUARANTINE_CODES = frozenset(
    {
        "GRAPH2PLAN_DEGENERATE_GRAPH",
        "GRAPH2PLAN_MULTIFLOOR",
        "GRAPH2PLAN_NO_ENTRANCE",
        "GRAPH2PLAN_UNMAPPED_ROOM",
        "GRAPH2PLAN_BOUNDARY_COMPONENTS",
        "GRAPH2PLAN_EMPTY_ROOMS",
        "GRAPH2PLAN_HOLES",
        "GRAPH2PLAN_ROOM_AREA",
        "GRAPH2PLAN_ROOM_COLLAPSE",
        "GRAPH2PLAN_DEGENERATE_BOX",
    }
)


def quarantine_code(error: ValueError) -> str | None:
    """Return the quarantine code for a data limitation, or ``None`` for a defect."""

    code = str(error).partition(":")[0].strip()
    return code if code in QUARANTINE_CODES else None

LABEL_NAMES = {index: name for index, name, _, _ in ROOM_LABEL}


# --------------------------------------------------------------------------------------
# Projection
# --------------------------------------------------------------------------------------


def grid_transform(canonical: dict[str, Any]) -> GridTransform:
    """Rebuild the shared cleaner's grid frame from the canonical record.

    ``build_records`` projects with ``from_vertices(repaired_vertices, north_angle)``
    and canonical stores exactly those inputs, so this reproduces the cleaner's frame
    and keeps every baseline on the same 256 / padding-8 grid.
    """

    north = canonical.get("site", {}).get("north_angle_deg", 0)
    try:
        north_angle = float(north or 0)
    except (TypeError, ValueError) as error:
        raise ValueError(f"GRAPH2PLAN_ROTATION: north angle {north!r}") from error
    if not math.isfinite(north_angle):
        raise ValueError("GRAPH2PLAN_ROTATION: north angle must be finite")
    return GridTransform.from_vertices(
        canonical["vertices"],
        north_angle_deg=north_angle,
        grid_size=GRID_SIZE,
        padding=GRID_PADDING,
    )


def _to_image_space(point: Sequence[int], grid_size: int = GRID_SIZE) -> list[int]:
    """Mirror the north-up grid into RPLAN image space, where y grows downwards."""

    return [int(point[0]), grid_size - 1 - int(point[1])]


def project_point(transform: GridTransform, point: Sequence[int]) -> list[int]:
    return _to_image_space(transform.forward(point))


def project_polygon(transform: GridTransform, points: Iterable[Sequence[int]]) -> list[list[int]]:
    """Project millimetre points into normalized, image-space grid coordinates."""

    return normalize_polygon(_to_image_space(transform.forward(point)) for point in points)


# --------------------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------------------


def _point_segment_distance(point: Sequence[int], start: Sequence[int], end: Sequence[int]) -> float:
    if start == end:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    dx, dy = end[0] - start[0], end[1] - start[1]
    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy))


def _project_onto_segment(
    point: Sequence[int], start: Sequence[int], end: Sequence[int]
) -> list[int]:
    """Perpendicular projection of ``point`` onto a segment, clamped to its ends."""

    if start == end:
        return [int(start[0]), int(start[1])]
    dx, dy = end[0] - start[0], end[1] - start[1]
    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return [math.floor(start[0] + t * dx + 0.5), math.floor(start[1] + t * dy + 0.5)]


def _parameter_along(point: Sequence[int], start: Sequence[int], end: Sequence[int]) -> int:
    """Monotone position of ``point`` along the directed edge ``start -> end``."""

    if end[0] != start[0]:
        return (point[0] - start[0]) * (1 if end[0] > start[0] else -1)
    return (point[1] - start[1]) * (1 if end[1] > start[1] else -1)


def _edge_direction(start: Sequence[int], end: Sequence[int]) -> int:
    """RPLAN ``dir`` of an edge: 0 right / 1 down / 2 left / 3 up."""

    dx, dy = end[0] - start[0], end[1] - start[1]
    if dy == 0 and dx != 0:
        return 0 if dx > 0 else 2
    if dx == 0 and dy != 0:
        return 1 if dy > 0 else 3
    raise ValueError(f"GRAPH2PLAN_DIAGONAL_BOUNDARY: {list(start)} -> {list(end)}")


def _collide2d(first: Sequence[int], second: Sequence[int], tolerance: int) -> bool:
    """RPLAN-Toolbox ``collide2d`` on (y0, x0, y1, x1) boxes."""

    return not (
        first[0] - tolerance > second[2]
        or first[2] + tolerance < second[0]
        or first[1] - tolerance > second[3]
        or first[3] + tolerance < second[1]
    )


def _boxes_overlap(first: Sequence[int], second: Sequence[int]) -> bool:
    """Positive-area overlap of two (x0, y0, x1, y1) boxes."""

    return min(first[2], second[2]) > max(first[0], second[0]) and (
        min(first[3], second[3]) > max(first[1], second[1])
    )


# --------------------------------------------------------------------------------------
# Relative-position predicates (Network/model/utils.py)
# --------------------------------------------------------------------------------------


def _point_box_relation(centre: tuple[float, float], box: Sequence[int]) -> int:
    """Network ``point_box_relation``, returning the predicate index directly.

    ``centre`` is (y, x) and ``box`` is (y0, x0, y1, x1), exactly as
    ``FloorPlan.get_triples`` calls it. The branch order and the exact boundary
    comparisons are upstream's and must not be tidied.
    """

    uy, ux = centre
    vy0, vx0, vy1, vx1 = box
    if (ux < vx0 and uy <= vy0) or (ux == vx0 and uy == vy0):
        return PREDICATES.index("left-above")
    if vx0 <= ux < vx1 and uy <= vy0:
        return PREDICATES.index("above")
    if (vx1 <= ux and uy < vy0) or (ux == vx1 and uy == vy0):
        return PREDICATES.index("right-above")
    if vx1 <= ux and vy0 <= uy < vy1:
        return PREDICATES.index("right-of")
    if (vx1 < ux and vy1 <= uy) or (ux == vx1 and uy == vy1):
        return PREDICATES.index("right-below")
    if vx0 < ux <= vx1 and vy1 <= uy:
        return PREDICATES.index("below")
    if (ux <= vx0 and vy1 < uy) or (ux == vx0 and uy == vy1):
        return PREDICATES.index("left-below")
    if ux <= vx0 and vy0 < uy <= vy1:
        return PREDICATES.index("left-of")
    if vx0 < ux < vx1 and vy0 < uy < vy1:
        return PREDICATES.index("inside")
    raise ValueError(f"GRAPH2PLAN_RELATION: no predicate for {centre} against {list(box)}")


def edge_predicate(boxes_yx: Sequence[Sequence[int]], u: int, v: int) -> int:
    """Reproduce ``FloorPlan.get_triples`` for the stored ordered pair ``(u, v)``.

    ``get_triples`` computes the relation of ``u`` relative to ``v`` for the order
    stored in rEdge, so surrounding/inside are symmetric but ``point_box_relation``
    is not.
    """

    uy0, ux0, uy1, ux1 = boxes_yx[u]
    vy0, vx0, vy1, vx1 = boxes_yx[v]
    if ux0 < vx0 and ux1 > vx1 and uy0 < vy0 and uy1 > vy1:
        return SURROUNDING_PREDICATE
    if ux0 >= vx0 and ux1 <= vx1 and uy0 >= vy0 and uy1 <= vy1:
        return INSIDE_PREDICATE
    centre = ((uy0 + uy1) / 2, (ux0 + ux1) / 2)
    return _point_box_relation(centre, boxes_yx[v])


# --------------------------------------------------------------------------------------
# Room order (Interface/align_fp/regularize_fp.m + find_room_order.m)
# --------------------------------------------------------------------------------------


def _find_room_order(precedence: set[tuple[int, int]], count: int) -> list[int]:
    """Transcription of ``find_room_order.m``: Kahn with upstream's cycle fallback."""

    remaining = set(range(count))
    order: list[int] = []
    while len(order) < count:
        indegree = {node: 0 for node in remaining}
        for before, after in precedence:
            if before in remaining and after in remaining:
                indegree[after] += 1
        zero = sorted(node for node in remaining if indegree[node] == 0)
        if zero:
            order.extend(zero)
            remaining.difference_update(zero)
            continue
        # Upstream breaks cycles by taking the lowest-numbered node with indegree 1.
        fallback = sorted(node for node in remaining if indegree[node] == 1)
        if not fallback:
            raise ValueError("GRAPH2PLAN_ORDER: room overlap graph has no resolvable node")
        order.append(fallback[0])
        remaining.discard(fallback[0])
    return order


def room_order(boxes: Sequence[Sequence[int]], areas: Sequence[float]) -> list[int]:
    """Return the 1-based ``order`` field exactly as ``regularize_fp.m`` builds it.

    ``orderM(i, j)`` marks the smaller of two overlapping boxes as coming first, and
    ``find_room_order`` returns a topological order of that relation. Upstream then
    reverses it unconditionally, so the final sequence starts with the largest room
    and every later box paints over the earlier ones -- which is why
    ``get_layout_image`` can skip index 0 (LivingRoom) and leave it as background.
    """

    count = len(boxes)
    precedence: set[tuple[int, int]] = set()
    for i in range(count):
        for j in range(i + 1, count):
            if not _boxes_overlap(boxes[i], boxes[j]):
                continue
            if areas[i] <= areas[j]:
                precedence.add((i, j))
            else:
                precedence.add((j, i))
    order = _find_room_order(precedence, count) if precedence else list(range(count))
    return [node + 1 for node in reversed(order)]


# --------------------------------------------------------------------------------------
# Front door selection
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Entrance:
    element_id: str
    face_id: str
    face_semantic: str
    host_wall_id: str
    host_wall_length_mm: float
    segment_grid: tuple[list[int], list[int]]
    rank_key: tuple


def _host_priority(semantic: str) -> int:
    """Rooms that make a dwelling's main entrance plausible, best first."""

    return (
        ENTRANCE_HOST_PRIORITY.index(semantic)
        if semantic in ENTRANCE_HOST_PRIORITY
        else len(ENTRANCE_HOST_PRIORITY)
    )


def entrance_candidates(canonical: dict[str, Any], transform: GridTransform) -> list[Entrance]:
    """Every exterior front door, ranked by a deterministic front-door heuristic.

    Only openings the cleaner resolved to *exactly one* room plus the outside, with a
    traversable people channel, can be a front door. Upstream keeps a single entrance
    in ``boundary[0:2]``, so the remaining doors are ranked and recorded, never
    dropped. Ranking is (hosts a living room or kitchen, longer host wall, lower x,
    lower y, element id): rural main facades are the long exterior walls, and main
    doors lead into the public room.
    """

    elements = {element["id"]: element for element in canonical["wall_elements"]}
    walls = {wall["id"]: wall for wall in canonical["walls"]}
    rooms = {room["id"]: room for room in canonical["rooms"]}
    candidates: list[Entrance] = []
    for relation in canonical["derived"]["outdoor_connections"]:
        element = elements.get(relation["wall_element_id"])
        if element is None or element.get("element_type") != "exterior_door":
            continue
        if relation.get("channels", {}).get("people") is not True:
            continue
        face_id = relation["from_face_id"]
        room = rooms.get(face_id)
        wall = walls.get(element["host_wall_id"])
        if room is None or wall is None:
            raise ValueError(
                f"GRAPH2PLAN_ENTRANCE: {element['id']} references an unknown room or wall"
            )
        segment = tuple(
            project_point(transform, point) for point in element["segment_mm"]
        )
        centre = (
            (segment[0][0] + segment[1][0]) / 2,
            (segment[0][1] + segment[1][1]) / 2,
        )
        candidates.append(
            Entrance(
                element_id=element["id"],
                face_id=face_id,
                face_semantic=room["semantic"],
                host_wall_id=wall["id"],
                host_wall_length_mm=float(wall.get("length_mm", 0)),
                segment_grid=(segment[0], segment[1]),
                rank_key=(
                    _host_priority(room["semantic"]),
                    -float(wall.get("length_mm", 0)),
                    centre[0],
                    centre[1],
                    element["id"],
                ),
            )
        )
    if not candidates:
        raise ValueError("GRAPH2PLAN_NO_ENTRANCE: no traversable exterior front door")
    candidates.sort(key=lambda candidate: candidate.rank_key)
    return candidates


# --------------------------------------------------------------------------------------
# Envelope + front door splice
# --------------------------------------------------------------------------------------


def _splice_front_door(
    loop: list[list[int]], door_segment: Sequence[Sequence[int]], element_id: str
) -> tuple[list[list[int]], list[bool], tuple[list[int], list[int]]]:
    """Insert the front door's two endpoints into the envelope and rotate to them.

    RPLAN intersects the front-door mask with the boundary edge and keeps the two
    crossing points, marking them ``isNew`` so ``regularize_fp`` can rebuild the
    polygon from ``boundary(~isNew)``. Room polygons are inner faces while doors sit
    on the wall centreline, so the door endpoints are first projected perpendicularly
    onto the nearest envelope edge; without that the points would float off the ring
    by half the wall thickness.
    """

    best = min(
        range(len(loop)),
        key=lambda index: sum(
            _point_segment_distance(point, loop[index], loop[(index + 1) % len(loop)])
            for point in door_segment
        ),
    )
    start, end = loop[best], loop[(best + 1) % len(loop)]
    projected = [_project_onto_segment(point, start, end) for point in door_segment]
    ordered = sorted(projected, key=lambda point: _parameter_along(point, start, end))
    if ordered[0] == ordered[1]:
        raise ValueError(
            f"GRAPH2PLAN_DOOR_COLLAPSE: {element_id} projects onto a single boundary point"
        )
    inserted = [point for point in ordered if point != start and point != end]
    if len(inserted) != len(set(map(tuple, inserted))):
        raise ValueError(f"GRAPH2PLAN_DOOR_COLLAPSE: {element_id} duplicates a boundary vertex")
    door_start = best if ordered[0] == start else best + 1
    spliced = loop[: best + 1] + inserted + loop[best + 1 :]
    flags = [False] * (best + 1) + [True] * len(inserted) + [False] * (len(loop) - best - 1)
    if len(spliced) != len(flags) or spliced[door_start] != ordered[0]:
        raise ValueError(f"GRAPH2PLAN_DOOR_COLLAPSE: {element_id} splice is inconsistent")
    # boundary[0:2] must be the door, so rotate the ring to start there.
    return (
        spliced[door_start:] + spliced[:door_start],
        flags[door_start:] + flags[:door_start],
        (ordered[0], ordered[1]),
    )


def build_boundary(
    loop: list[list[int]], door: Entrance
) -> tuple[list[list[int]], list[list[int]]]:
    """Return the (x, y, dir, isNew) boundary and the door's grid endpoints."""

    points, is_new, door_points = _splice_front_door(loop, door.segment_grid, door.element_id)
    # A door endpoint that lands exactly on a corner keeps isNew=0, exactly as RPLAN
    # leaves it, so boundary[0] may legitimately be a corner rather than an inserted point.
    if points[0] == points[1]:
        raise ValueError(f"GRAPH2PLAN_DOOR_COLLAPSE: {door.element_id} door row is degenerate")
    rows = [
        [point[0], point[1], _edge_direction(point, points[(index + 1) % len(points)]), int(is_new[index])]
        for index, point in enumerate(points)
    ]
    return rows, [list(door_points[0]), list(door_points[1])]


# --------------------------------------------------------------------------------------
# Edges
# --------------------------------------------------------------------------------------


def _predicate_name(index: int) -> str:
    return PREDICATES[index]


def door_based_edges(
    canonical: dict[str, Any], room_index: dict[str, int], boxes_yx: Sequence[Sequence[int]]
) -> list[dict[str, Any]]:
    """Reuse the cleaner's existing door-mediated room-room graph as ``rEdge``.

    ``derived.room_adjacency`` is one entry per opening that connects two rooms, so
    the pairs are collapsed and emitted as ``u < v`` -- the orientation RPLAN-Toolbox's
    ``get_edges`` uses.
    """

    pairs: dict[tuple[int, int], set[str]] = {}
    for relation in canonical["derived"]["room_adjacency"]:
        source = room_index[relation["from_face_id"]]
        target = room_index[relation["to"]["face_id"]]
        if source == target:
            raise ValueError(f"GRAPH2PLAN_SELF_EDGE: {relation['from_face_id']}")
        pair = (min(source, target), max(source, target))
        pairs.setdefault(pair, set()).add(relation["wall_element_id"])
    edges = []
    for (u, v), element_ids in sorted(pairs.items()):
        predicate = edge_predicate(boxes_yx, u, v)
        edges.append(
            {
                "u": u,
                "v": v,
                "predicate": predicate,
                "predicate_name": _predicate_name(predicate),
                "wall_element_ids": sorted(element_ids),
            }
        )
    return edges


def bbox_overlap_edges(
    boxes_yx: Sequence[Sequence[int]],
) -> list[dict[str, Any]]:
    """The upstream RPLAN-Toolbox rule, for comparison only.

    ``_get_edges(th=9)`` emits every pair whose bboxes touch within nine pixels,
    regardless of whether a door connects them. It is reported next to the reused
    door graph so the difference between the two conventions is measurable instead of
    assumed.
    """

    edges = []
    for u in range(len(boxes_yx)):
        for v in range(u + 1, len(boxes_yx)):
            if not _collide2d(boxes_yx[u], boxes_yx[v], BBOX_COLLISION_TOLERANCE):
                continue
            predicate = edge_predicate(boxes_yx, u, v)
            edges.append(
                {
                    "u": u,
                    "v": v,
                    "predicate": predicate,
                    "predicate_name": _predicate_name(predicate),
                }
            )
    return edges


# --------------------------------------------------------------------------------------
# Sample assembly
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Graph2PlanSample:
    building_id: str
    record_id: str
    boundary: list[list[int]]
    door_grid: list[list[int]]
    rooms: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    order: list[int]
    entrances: list[Entrance]
    chosen_entrance: Entrance
    comparison: dict[str, Any]
    transform: dict[str, Any]
    warnings: list[str] = field(default_factory=list)

    @property
    def boxes_yx(self) -> list[list[int]]:
        return [[box[1], box[0], box[3], box[2]] for box in (room["bbox"] for room in self.rooms)]


def _record_id(canonical: dict[str, Any]) -> str:
    return str(canonical.get("record_id", canonical["building_id"]))


def build_sample(canonical: dict[str, Any]) -> Graph2PlanSample:
    """Derive every Graph2Plan field for one canonical building."""

    if canonical.get("source", {}).get("workflow_status") != "complete":
        raise ValueError("GRAPH2PLAN_NOT_COMPLETE: source workflow is not complete")
    floors = canonical.get("floors", [])
    if sum(bool(item.get("face_ids") or item.get("wall_ids")) for item in floors) > 1:
        raise ValueError("GRAPH2PLAN_MULTIFLOOR: 请按楼层分别转换")

    transform = grid_transform(canonical)
    rooms = sorted(canonical["rooms"], key=lambda room: room["id"])
    if not rooms:
        raise ValueError("GRAPH2PLAN_EMPTY_ROOMS")

    prepared: list[dict[str, Any]] = []
    for room in rooms:
        if room.get("properties", {}).get("holes"):
            raise ValueError(f"GRAPH2PLAN_HOLES: {room['id']}")
        try:
            polygon = project_polygon(transform, room["polygon_mm"])
        except ValueError as error:
            raise ValueError(f"GRAPH2PLAN_ROOM_AREA: {room['id']} ({error})") from error
        if len({tuple(point) for point in polygon}) != len(polygon):
            raise ValueError(f"GRAPH2PLAN_ROOM_COLLAPSE: {room['id']}")
        xs = [point[0] for point in polygon]
        ys = [point[1] for point in polygon]
        bbox = [min(xs), min(ys), max(xs) + 1, max(ys) + 1]
        if bbox[2] - bbox[0] < 1 or bbox[3] - bbox[1] < 1:
            raise ValueError(f"GRAPH2PLAN_DEGENERATE_BOX: {room['id']}")
        label = room_type(room["semantic"])
        prepared.append(
            {
                "id": room["id"],
                "semantic": room["semantic"],
                "label": label,
                "label_name": LABEL_NAMES[label],
                "display_name": room.get("display_name", ""),
                "original_function_code": room.get("original_function_code"),
                "polygon": polygon,
                "bbox": bbox,
                "area_mm2": room["area_mm2"],
            }
        )

    components = canonical["derived"]["occupied_boundary_components_mm"]
    if len(components) != 1:
        raise ValueError(f"GRAPH2PLAN_BOUNDARY_COMPONENTS: {len(components)} separate envelopes")

    entrances = entrance_candidates(canonical, transform)
    boundary, door_grid = build_boundary(
        project_polygon(transform, components[0]), entrances[0]
    )

    room_index = {room["id"]: index for index, room in enumerate(prepared)}
    boxes_yx = [[box[1], box[0], box[3], box[2]] for box in (room["bbox"] for room in prepared)]
    edges = door_based_edges(canonical, room_index, boxes_yx)
    if len(edges) < MINIMUM_EDGE_COUNT:
        raise ValueError(
            f"GRAPH2PLAN_DEGENERATE_GRAPH: {len(edges)} room-room edge(s); "
            f"at least {MINIMUM_EDGE_COUNT} real room-room edge is required"
        )
    alternative = bbox_overlap_edges(boxes_yx)
    door_pairs = {(edge["u"], edge["v"]) for edge in edges}
    bbox_pairs = {(edge["u"], edge["v"]) for edge in alternative}
    comparison = {
        "door_based_edge_count": len(door_pairs),
        "bbox_overlap_edge_count": len(bbox_pairs),
        "shared": len(door_pairs & bbox_pairs),
        "door_only": sorted([u, v] for u, v in door_pairs - bbox_pairs),
        "bbox_only": sorted([u, v] for u, v in bbox_pairs - door_pairs),
        "bbox_collision_tolerance": BBOX_COLLISION_TOLERANCE,
        "note": (
            "rEdge follows the cleaner's door-mediated room graph. Upstream RPLAN uses "
            "bbox collision instead; bbox_only pairs are the measured difference."
        ),
    }

    areas = [(room["bbox"][2] - room["bbox"][0]) * (room["bbox"][3] - room["bbox"][1]) for room in prepared]
    order = room_order([room["bbox"] for room in prepared], areas)
    if sorted(order) != list(range(1, len(prepared) + 1)):
        raise ValueError("GRAPH2PLAN_ORDER: order is not a permutation of 1..n")

    warnings = []
    if len(entrances) > 1:
        warnings.append(
            f"MULTIPLE_ENTRANCES: {len(entrances)} exterior doors, "
            f"boundary[0:2] encodes {entrances[0].element_id}"
        )
    if comparison["bbox_only"]:
        warnings.append(
            f"BBOX_ONLY_ADJACENCY: {len(comparison['bbox_only'])} pair(s) present upstream "
            "but not in the door-mediated graph"
        )

    return Graph2PlanSample(
        building_id=canonical["building_id"],
        record_id=_record_id(canonical),
        boundary=boundary,
        door_grid=door_grid,
        rooms=prepared,
        edges=edges,
        order=order,
        entrances=entrances,
        chosen_entrance=entrances[0],
        comparison=comparison,
        transform=transform.as_dict(),
        warnings=warnings,
    )


def mat_record(sample: Graph2PlanSample, *, profile: str = "official") -> dict[str, Any]:
    """The eight fields ``DataPreparation/2.data_train_converted.py`` copies out."""

    record = {
        "name": sample.building_id,
        "boundary": [list(row) for row in sample.boundary],
        "rType": [room["label"] for room in sample.rooms],
        "gtBoxNew": [list(room["bbox"]) for room in sample.rooms],
        "gtBox": [[box[1], box[0], box[3], box[2]] for box in (room["bbox"] for room in sample.rooms)],
        "rEdge": [[edge["u"], edge["v"], edge["predicate"]] for edge in sample.edges],
        "order": list(sample.order),
        "rBoundary": [[list(point) for point in room["polygon"]] for room in sample.rooms],
    }
    if profile == "rural-multi":
        loop = [row[:2] for row in sample.boundary if not row[3]]
        record["entrances"] = [build_boundary(loop, door)[1] for door in sample.entrances]
    elif profile != "official":
        raise ValueError(f"Unknown Graph2Plan profile: {profile}")
    return record


def record_schema_document(*, profile: str = "official") -> dict[str, Any]:
    """JSON Schema for one ``data`` record, i.e. one row of ``data_*.mat``."""

    integer = {"type": "integer"}
    box = {"type": "array", "minItems": 4, "maxItems": 4, "items": integer}
    point = {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "number"}}
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Graph2Plan rural record",
        "type": "object",
        "additionalProperties": False,
        "required": list(MAT_FIELDS),
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "boundary": {
                "type": "array",
                "minItems": 4,
                "items": {
                    "type": "array",
                    "minItems": 4,
                    "maxItems": 4,
                    "prefixItems": [
                        integer,
                        integer,
                        {"type": "integer", "enum": [0, 1, 2, 3]},
                        {"type": "integer", "enum": [0, 1]},
                    ],
                    "items": False,
                },
            },
            "rType": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "integer", "minimum": 0, "maximum": ROOM_LABEL_MAX},
            },
            "gtBoxNew": {"type": "array", "minItems": 1, "items": box},
            "gtBox": {"type": "array", "minItems": 1, "items": box},
            "rEdge": {
                "type": "array",
                "minItems": MINIMUM_EDGE_COUNT,
                "items": {
                    "type": "array",
                    "minItems": 3,
                    "maxItems": 3,
                    "prefixItems": [
                        {"type": "integer", "minimum": 0},
                        {"type": "integer", "minimum": 0},
                        {"type": "integer", "minimum": 0, "maximum": len(PREDICATES) - 1},
                    ],
                    "items": False,
                },
            },
            "order": {"type": "array", "minItems": 1, "items": {"type": "integer", "minimum": 1}},
            "rBoundary": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "array", "minItems": 3, "items": point},
            },
        },
    }
    if profile == "rural-multi":
        schema["required"].append("entrances")
        schema["properties"]["entrances"] = {
            "type": "array", "minItems": 1,
            "items": {"type": "array", "minItems": 2, "maxItems": 2,
                      "items": {"type": "array", "minItems": 2, "maxItems": 2,
                                "items": {"type": "integer", "minimum": 0, "maximum": 255}}},
        }
    elif profile != "official":
        raise ValueError(f"Unknown Graph2Plan profile: {profile}")
    return schema


def validate_record(record: dict[str, Any], *, profile: str = "official") -> None:
    """Validate a record against the public schema before it is published."""

    from jsonschema import Draft202012Validator

    Draft202012Validator(record_schema_document(profile=profile)).validate(record)


def mapping_document(sample: Graph2PlanSample) -> dict[str, Any]:
    """The sidecar that keeps every decision and every dropped entrance auditable."""

    return {
        "schema_version": MAPPING_SCHEMA_VERSION,
        "building_id": sample.building_id,
        "record_id": sample.record_id,
        "grid": sample.transform,
        "rooms": [
            {
                "index": index,
                "source_id": room["id"],
                "semantic": room["semantic"],
                "display_name": room["display_name"],
                "original_function_code": room["original_function_code"],
                "rType": room["label"],
                "rType_name": room["label_name"],
                "area_mm2": room["area_mm2"],
                "bbox_grid": list(room["bbox"]),
                "polygon_grid": [list(point) for point in room["polygon"]],
            }
            for index, room in enumerate(sample.rooms)
        ],
        "edges": sample.edges,
        "edge_source": "building.json relations -> canonical derived.room_adjacency (door-mediated)",
        "edge_comparison": sample.comparison,
        "order": sample.order,
        "order_rule": "regularize_fp.m overlap precedence + find_room_order.m, reversed; 1-based",
        "front_door": {
            "element_id": sample.chosen_entrance.element_id,
            "face_id": sample.chosen_entrance.face_id,
            "face_semantic": sample.chosen_entrance.face_semantic,
            "host_wall_id": sample.chosen_entrance.host_wall_id,
            "host_wall_length_mm": sample.chosen_entrance.host_wall_length_mm,
            "segment_grid": [list(point) for point in sample.chosen_entrance.segment_grid],
            "boundary_segment_grid": sample.door_grid,
        },
        "other_entrances": [
            {
                "element_id": entrance.element_id,
                "face_id": entrance.face_id,
                "face_semantic": entrance.face_semantic,
                "host_wall_id": entrance.host_wall_id,
                "host_wall_length_mm": entrance.host_wall_length_mm,
                "segment_grid": [list(point) for point in entrance.segment_grid],
                "rank_key": list(entrance.rank_key),
                "encoded": index == 0,
            }
            for index, entrance in enumerate(sample.entrances)
        ],
        "warnings": sample.warnings,
    }
