"""Exact, source-ID independent projection of observable editor geometry."""

from __future__ import annotations

from typing import Any, Literal, NoReturn

from pydantic import BaseModel, ConfigDict, Field, field_validator

from embodied.building import BuildingDocument

Point = tuple[int, int]


class _FrozenChannels(dict[str, bool]):
    """A JSON-serializable dictionary with mutation disabled."""

    def _deny(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("channels are immutable")

    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = __ior__ = _deny

    def __copy__(self) -> _FrozenChannels:
        return self

    def __deepcopy__(self, memo: dict[int, Any]) -> _FrozenChannels:
        return self


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True, extra="forbid")


class Wall(_Frozen):
    id: str
    start: Point
    end: Point
    wall_type: str
    thickness_mm: int = Field(gt=0)
    height_mm: int = Field(gt=0)
    material_type: str


class Boundary(_Frozen):
    wall_id: str
    start_mm: int
    end_mm: int


class Room(_Frozen):
    id: str
    polygon: tuple[Point, ...]
    function: str | None
    boundary: tuple[Boundary, ...]


class Opening(_Frozen):
    id: str
    opening_type: Literal["exterior_door", "interior_door", "exterior_window", "passage"]
    host_wall_id: str
    offset_mm: int = Field(ge=0)
    width_mm: int = Field(gt=0)
    height_mm: int = Field(gt=0)
    sill_height_mm: int = Field(ge=0)
    room_ids: tuple[str, ...]
    connects_outside: bool
    channels: dict[str, bool]

    @field_validator("channels")
    @classmethod
    def freeze_channels(cls, value: dict[str, bool]) -> dict[str, bool]:
        return _FrozenChannels(sorted(value.items()))


class CanonicalFloorplan(_Frozen):
    schema_version: Literal["canonical-floorplan/2"] = "canonical-floorplan/2"
    rooms: tuple[Room, ...]
    walls: tuple[Wall, ...]
    openings: tuple[Opening, ...]
    width_mm: int = Field(gt=0)
    height_mm: int = Field(gt=0)


def _length(a: Point, b: Point) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def _intersection(a: Point, b: Point, c: Point, d: Point) -> bool:
    """Closed orthogonal segment intersection, including touching."""
    return max(min(a[0], b[0]), min(c[0], d[0])) <= min(max(a[0], b[0]), max(c[0], d[0])) and max(
        min(a[1], b[1]), min(c[1], d[1])
    ) <= min(max(a[1], b[1]), max(c[1], d[1]))


def _polygon(points: tuple[Point, ...]) -> tuple[Point, ...]:
    points = tuple(points)
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 4 or len(set(points)) != len(points):
        raise ValueError("UNSUPPORTED_GEOMETRY: degenerate polygon")
    edges = list(zip(points, points[1:] + points[:1], strict=True))
    for a, b in edges:
        if (a[0] == b[0]) == (a[1] == b[1]):
            raise ValueError("UNSUPPORTED_GEOMETRY: nonorthogonal polygon")
    for i, (a, b) in enumerate(edges):
        for j, (c, d) in enumerate(edges):
            if j > i + 1 and not (i == 0 and j == len(edges) - 1) and _intersection(a, b, c, d):
                raise ValueError("UNSUPPORTED_GEOMETRY: self intersecting polygon")
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in edges)
    if not area:
        raise ValueError("UNSUPPORTED_GEOMETRY: zero area")
    if area < 0:
        points = points[::-1]
    idx = min(range(len(points)), key=lambda i: points[i:] + points[:i])
    return points[idx:] + points[:idx]


def _interiors_overlap(first: tuple[Point, ...], second: tuple[Point, ...]) -> bool:
    """Sweep open horizontal slabs, using doubled integers for exact midpoints."""
    levels = sorted({p[1] for p in first + second})
    for low, high in zip(levels, levels[1:], strict=False):
        twice_y = low + high
        slices = []
        for polygon in (first, second):
            crossings = sorted(
                a[0]
                for a, b in zip(polygon, polygon[1:] + polygon[:1], strict=True)
                if a[0] == b[0] and 2 * min(a[1], b[1]) < twice_y < 2 * max(a[1], b[1])
            )
            slices.append(list(zip(crossings[::2], crossings[1::2], strict=True)))
        if any(max(a, c) < min(b, d) for a, b in slices[0] for c, d in slices[1]):
            return True
    return False


def canonicalize_floorplan(document: BuildingDocument | CanonicalFloorplan) -> CanonicalFloorplan:
    """Project supported geometry, rejecting anything invisible to room boundaries."""
    if isinstance(document, BuildingDocument):
        if any(
            (document.model_extra or {}).get(key)
            for key in ("obstacles", "interior_obstacles", "holes", "interior_rings")
        ):
            raise ValueError(
                "UNSUPPORTED_GEOMETRY: explicit obstacles/holes require a future codec"
            )
        if document.coordinate_system.get("storage_unit") != "mm":
            raise ValueError("UNSUPPORTED_GEOMETRY: millimetres required")
        try:
            vertices = {k: (v.x_mm, v.y_mm) for k, v in document.vertices.items()}
            walls = [
                Wall(
                    id=k,
                    start=vertices[w.start_vertex_id],
                    end=vertices[w.end_vertex_id],
                    **w.model_dump(exclude={"start_vertex_id", "end_vertex_id"}),
                )
                for k, w in document.walls.items()
            ]
            rooms = [
                Room(
                    id=k,
                    polygon=tuple(vertices[v] for v in r.boundary_vertex_ids),
                    function=r.function_code,
                    boundary=(),
                )
                for k, r in document.faces.items()
            ]
        except KeyError as exc:
            raise ValueError("UNSUPPORTED_GEOMETRY: dangling vertex") from exc
        openings = []
        for rel in document.relations:
            if rel.wall_element_id not in document.wall_elements:
                raise ValueError("INCONSISTENT_INCIDENCE: dangling relation")
        for k, raw_opening in document.wall_elements.items():
            relations = [r for r in document.relations if r.wall_element_id == k]
            if not relations:
                raise ValueError("UNOBSERVED_OPENING: no relation")
            incidence = set()
            outside = False
            for r in relations:
                incidence.add(r.from_face_id)
                if r.to.kind == "face":
                    if r.to.face_id is None:
                        raise ValueError("INCONSISTENT_INCIDENCE")
                    incidence.add(r.to.face_id)
                else:
                    outside = True
                if r.channels != relations[0].channels:
                    raise ValueError("INCONSISTENT_CHANNELS")
            openings.append(
                Opening(
                    id=k,
                    opening_type=raw_opening.element_type,
                    host_wall_id=raw_opening.host_wall_id,
                    offset_mm=raw_opening.offset_from_start_mm,
                    width_mm=raw_opening.width_mm,
                    height_mm=raw_opening.height_mm,
                    sill_height_mm=raw_opening.sill_height_mm,
                    room_ids=tuple(sorted(incidence)),
                    connects_outside=outside,
                    channels=relations[0].channels,
                )
            )
    elif isinstance(document, CanonicalFloorplan):
        walls, rooms, openings = list(document.walls), list(document.rooms), list(document.openings)
    else:
        raise TypeError("expected BuildingDocument or CanonicalFloorplan")
    for values in (walls, rooms, openings):
        if len({v.id for v in values}) != len(values):
            raise ValueError("AMBIGUOUS_GEOMETRY: duplicate IDs")
    if not walls or not rooms:
        raise ValueError("UNOBSERVABLE_GEOMETRY: empty floorplan")
    points = [p for w in walls for p in (w.start, w.end)] + [p for r in rooms for p in r.polygon]
    xmin, ymin = min(p[0] for p in points), min(p[1] for p in points)

    def translate(p: Point) -> Point:
        return (p[0] - xmin, p[1] - ymin)

    normalized_walls = []
    reversed_walls = set()
    for w in walls:
        a, b = translate(w.start), translate(w.end)
        if (a[0] == b[0]) == (a[1] == b[1]):
            raise ValueError("UNSUPPORTED_GEOMETRY: nonorthogonal wall")
        if a > b:
            a, b = b, a
            reversed_walls.add(w.id)
        normalized_walls.append(w.model_copy(update={"start": a, "end": b}))
    normalized_walls.sort(
        key=lambda w: (w.start, w.end, w.wall_type, w.thickness_mm, w.height_mm, w.material_type)
    )
    for i, w in enumerate(normalized_walls):
        for v in normalized_walls[:i]:
            axis = 0 if w.start[1] == w.end[1] else 1
            if v.start[1 - axis] == v.end[1 - axis] == w.start[1 - axis] and max(
                w.start[axis], v.start[axis]
            ) < min(w.end[axis], v.end[axis]):
                raise ValueError("AMBIGUOUS_GEOMETRY: overlapping walls")
    wall_map = {w.id: f"W{i}" for i, w in enumerate(normalized_walls)}
    wall_by_id = {w.id: w for w in normalized_walls}

    def split_at_host_endpoints(polygon: tuple[Point, ...]) -> tuple[Point, ...]:
        # A long room edge may span several physical hosts. These split vertices
        # must be canonical before room ordering, not first invented by decoding.
        expanded = []
        endpoints = {p for wall in normalized_walls for p in (wall.start, wall.end)}
        for a, b in zip(polygon, polygon[1:] + polygon[:1], strict=True):
            axis = 0 if a[1] == b[1] else 1
            cuts = {a} | {
                p
                for p in endpoints
                if p[1 - axis] == a[1 - axis]
                and min(a[axis], b[axis]) < p[axis] < max(a[axis], b[axis])
            }
            expanded.extend(sorted(cuts, key=lambda p: p[axis], reverse=a[axis] > b[axis]))
        return _polygon(tuple(expanded))

    normalized_rooms = [
        (r, split_at_host_endpoints(_polygon(tuple(translate(p) for p in r.polygon))))
        for r in rooms
    ]
    normalized_rooms.sort(key=lambda item: (item[1], item[0].function or ""))
    if len({p for _, p in normalized_rooms}) != len(rooms):
        raise ValueError("AMBIGUOUS_GEOMETRY: duplicate rooms")
    for i, (_, polygon) in enumerate(normalized_rooms):
        if any(_interiors_overlap(polygon, previous) for _, previous in normalized_rooms[:i]):
            raise ValueError("AMBIGUOUS_GEOMETRY: overlapping room interiors")
    room_map = {r.id: f"R{i}" for i, (r, _) in enumerate(normalized_rooms)}
    coverage: dict[str, list[tuple[int, int]]] = {w.id: [] for w in walls}
    room_coverage = {}
    result_rooms = []
    for room, polygon in normalized_rooms:
        bounds = []
        local: dict[str, list[tuple[int, int]]] = {}
        for a, b in zip(polygon, polygon[1:] + polygon[:1], strict=True):
            axis = 0 if a[1] == b[1] else 1
            lo, hi = sorted((a[axis], b[axis]))
            parts = []
            for w in normalized_walls:
                if w.start[1 - axis] != a[1 - axis] or w.end[1 - axis] != a[1 - axis]:
                    continue
                start, end = max(lo, w.start[axis]), min(hi, w.end[axis])
                if start < end:
                    parts.append((start, end, w))
            parts.sort(key=lambda p: p[0])
            cursor = lo
            for start, end, w in parts:
                if start != cursor:
                    raise ValueError("UNOBSERVABLE_GEOMETRY: room boundary coverage")
                cursor = end
                interval = (start - w.start[axis], end - w.start[axis])
                coverage[w.id].append(interval)
                local.setdefault(w.id, []).append(interval)
            if cursor != hi:
                raise ValueError("UNOBSERVABLE_GEOMETRY: room boundary gap")
            if a[axis] > b[axis]:
                parts.reverse()
            for start, end, w in parts:
                s, e = start - w.start[axis], end - w.start[axis]
                if a[axis] > b[axis]:
                    s, e = e, s
                bounds.append(Boundary(wall_id=wall_map[w.id], start_mm=s, end_mm=e))
        for host_id, intervals in local.items():
            merged: list[tuple[int, int]] = []
            for start, end in sorted(intervals):
                if merged and start <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(merged[-1][1], end))
                else:
                    merged.append((start, end))
            local[host_id] = merged
        room_coverage[room.id] = local
        if isinstance(document, CanonicalFloorplan):
            expected = sorted(
                (b.wall_id, min(b.start_mm, b.end_mm), max(b.start_mm, b.end_mm)) for b in bounds
            )
            observed = []
            for boundary in room.boundary:
                if boundary.wall_id not in wall_map:
                    raise ValueError("INCONSISTENT_INCIDENCE: unknown boundary wall")
                s, e = boundary.start_mm, boundary.end_mm
                if boundary.wall_id in reversed_walls:
                    host = wall_by_id[boundary.wall_id]
                    length = _length(host.start, host.end)
                    s, e = length - s, length - e
                observed.append((wall_map[boundary.wall_id], min(s, e), max(s, e)))
            if sorted(observed) != expected:
                raise ValueError("INCONSISTENT_INCIDENCE: canonical boundary")
        result_rooms.append(
            Room(
                id=room_map[room.id],
                polygon=polygon,
                function=room.function,
                boundary=tuple(bounds),
            )
        )
    for w in normalized_walls:
        cursor = 0
        for start, end in sorted(coverage[w.id]):
            if start > cursor:
                raise ValueError("UNOBSERVABLE_GEOMETRY: uncovered wall")
            cursor = max(cursor, end)
        if cursor != _length(w.start, w.end):
            raise ValueError("UNOBSERVABLE_GEOMETRY: uncovered wall")
    result_openings = []
    for o in openings:
        if o.host_wall_id not in wall_by_id:
            raise ValueError("UNOBSERVED_OPENING: missing wall")
        w = wall_by_id[o.host_wall_id]
        length = _length(w.start, w.end)
        offset = length - o.offset_mm - o.width_mm if w.id in reversed_walls else o.offset_mm
        if offset < 0 or offset + o.width_mm > length:
            raise ValueError("UNOBSERVED_OPENING: outside wall")
        incident = {
            r
            for r, hosts in room_coverage.items()
            if any(s <= offset and offset + o.width_mm <= e for s, e in hosts.get(w.id, []))
        }
        if not incident:
            raise ValueError("UNOBSERVED_OPENING")
        if (
            incident != set(o.room_ids)
            or len(o.room_ids) != len(set(o.room_ids))
            or len(incident) not in (1, 2)
            or o.connects_outside != (len(incident) == 1)
        ):
            raise ValueError("INCONSISTENT_INCIDENCE")
        if (o.opening_type.startswith("exterior_") and not o.connects_outside) or (
            o.opening_type == "interior_door" and o.connects_outside
        ):
            raise ValueError("INCONSISTENT_INCIDENCE: opening type")
        result_openings.append(
            o.model_copy(
                update={
                    "host_wall_id": wall_map[w.id],
                    "offset_mm": offset,
                    "room_ids": tuple(sorted(room_map[r] for r in incident)),
                }
            )
        )
    result_openings.sort(
        key=lambda o: (
            o.host_wall_id,
            o.offset_mm,
            o.width_mm,
            o.opening_type,
            o.height_mm,
            o.sill_height_mm,
            o.room_ids,
            tuple(sorted(o.channels.items())),
        )
    )
    for i, o in enumerate(result_openings):
        for prev in result_openings[:i]:
            if prev.host_wall_id == o.host_wall_id and max(prev.offset_mm, o.offset_mm) < min(
                prev.offset_mm + prev.width_mm, o.offset_mm + o.width_mm
            ):
                raise ValueError("AMBIGUOUS_GEOMETRY: overlapping openings")
    return CanonicalFloorplan(
        rooms=tuple(result_rooms),
        walls=tuple(w.model_copy(update={"id": wall_map[w.id]}) for w in normalized_walls),
        openings=tuple(o.model_copy(update={"id": f"O{i}"}) for i, o in enumerate(result_openings)),
        width_mm=max(p[0] for p in points) - xmin,
        height_mm=max(p[1] for p in points) - ymin,
    )
