"""Opening geometry, room attachment, and anchor derivation."""

from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.domain.geometry import Direction, Point2D
from rural_embodied_plan.domain.navigation import Opening, OpeningType, Room, WallSegment
from rural_embodied_plan.geometry.directions import opposite, vector

_TYPE_MAP = {
    "exterior_door": OpeningType.EXTERIOR_DOOR,
    "interior_door": OpeningType.INTERIOR_DOOR,
    "exterior_window": OpeningType.WINDOW,
    "passage": OpeningType.OPEN_PASSAGE,
}


def _offset(point: Point2D, direction: Direction, distance: int) -> Point2D:
    dx, dy = vector(direction)
    return Point2D(x_mm=point.x_mm + dx * distance, y_mm=point.y_mm + dy * distance)


def build_openings(
    document: BuildingDocument,
    rooms: list[Room],
    wall_segments: list[WallSegment],
    anchor_offset_mm: int,
) -> tuple[list[Opening], list[Room], list[WallSegment], list[str]]:
    """Build sorted canonical openings using explicit relations and geometry."""

    relation_by_element = {relation.wall_element_id: relation for relation in document.relations}
    if len(relation_by_element) != len(document.relations):
        raise ValueError("Duplicate wall_element_id in relations")
    segments_by_wall: dict[str, list[WallSegment]] = {}
    for segment in wall_segments:
        segments_by_wall.setdefault(segment.source_wall_id, []).append(segment)
    warnings: list[str] = []
    openings: list[Opening] = []
    room_openings: dict[str, list[str]] = {room.id: [] for room in rooms}
    segment_openings: dict[str, list[str]] = {segment.id: [] for segment in wall_segments}
    for opening_id, element in sorted(document.wall_elements.items()):
        if opening_id not in relation_by_element:
            raise ValueError(f"Opening {opening_id} has no connectivity relation")
        relation = relation_by_element[opening_id]
        if relation.from_face_id not in room_openings:
            raise ValueError(
                f"Opening {opening_id} references missing room {relation.from_face_id}"
            )
        room_ids = [relation.from_face_id]
        connects_outside = relation.to.kind == "outside"
        if relation.to.kind == "face":
            assert relation.to.face_id is not None
            if relation.to.face_id not in room_openings:
                raise ValueError(
                    f"Opening {opening_id} references missing room {relation.to.face_id}"
                )
            room_ids.append(relation.to.face_id)
        room_ids = sorted(room_ids)
        if element.status == "needs_review":
            warnings.append(f"Opening {opening_id} is marked needs_review")
        try:
            wall = document.walls[element.host_wall_id]
            start = document.vertices[wall.start_vertex_id]
            end = document.vertices[wall.end_vertex_id]
        except KeyError as exc:
            raise ValueError(
                f"Opening {opening_id} has invalid host geometry: {exc.args[0]}"
            ) from exc
        wall_length = abs(end.x_mm - start.x_mm) + abs(end.y_mm - start.y_mm)
        center_offset_twice = 2 * element.offset_from_start_mm + element.width_mm
        if center_offset_twice > 2 * wall_length:
            raise ValueError(f"Opening {opening_id} extends beyond host wall")
        center_distance = center_offset_twice / 2
        if start.x_mm == end.x_mm:
            sign = 1 if end.y_mm > start.y_mm else -1
            center = Point2D(x_mm=start.x_mm, y_mm=round(start.y_mm + sign * center_distance))
        elif start.y_mm == end.y_mm:
            sign = 1 if end.x_mm > start.x_mm else -1
            center = Point2D(x_mm=round(start.x_mm + sign * center_distance), y_mm=start.y_mm)
        else:
            raise ValueError(f"Opening {opening_id} is hosted on a non-orthogonal wall")
        if center_offset_twice % 2:
            warnings.append(f"Opening {opening_id} center was rounded to the nearest millimetre")
        directions: dict[str, Direction] = {}
        anchors: dict[str, Point2D] = {}
        matching_segments = segments_by_wall.get(element.host_wall_id, [])
        for room_id in room_ids:
            room_segments = [segment for segment in matching_segments if segment.room_id == room_id]
            if len(room_segments) != 1:
                raise ValueError(
                    f"Opening {opening_id} host wall has {len(room_segments)} "
                    f"boundary segments for {room_id}"
                )
            outward = room_segments[0].global_direction
            directions[room_id] = outward
            anchors[room_id] = _offset(center, opposite(outward), anchor_offset_mm)
            segment_openings[room_segments[0].id].append(opening_id)
            room_openings[room_id].append(opening_id)
        outside_anchor = None
        if connects_outside:
            outside_anchor = _offset(center, directions[room_ids[0]], anchor_offset_mm)
        openings.append(
            Opening(
                id=opening_id,
                opening_type=_TYPE_MAP[element.element_type],
                source_element_type=element.element_type,
                host_wall_id=element.host_wall_id,
                room_ids=room_ids,
                connects_outside=connects_outside,
                center=center,
                width_mm=element.width_mm,
                normalized_position=center_distance / wall_length,
                global_directions=directions,
                room_anchors=anchors,
                outside_anchor=outside_anchor,
            )
        )
    updated_rooms = [
        room.model_copy(update={"opening_ids": sorted(room_openings[room.id])}) for room in rooms
    ]
    opening_map = {opening.id: opening for opening in openings}
    updated_segments = []
    for segment in wall_segments:
        ids = segment_openings[segment.id]
        ids.sort(
            key=lambda opening_id: (
                opening_map[opening_id].center.x_mm
                if segment.segment.start.y_mm == segment.segment.end.y_mm
                else opening_map[opening_id].center.y_mm,
                opening_id,
            )
        )
        updated_segments.append(segment.model_copy(update={"opening_ids": ids}))
    return openings, updated_rooms, updated_segments, sorted(warnings)
