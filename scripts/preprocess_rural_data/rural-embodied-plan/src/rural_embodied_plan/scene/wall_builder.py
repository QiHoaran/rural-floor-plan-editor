"""Room-boundary wall segmentation and direction derivation."""

from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.domain.geometry import Direction, LineSegment, Point2D
from rural_embodied_plan.domain.navigation import Room, WallSegment
from rural_embodied_plan.geometry.predicates import segment_covers


def _outward_direction(start: Point2D, end: Point2D) -> Direction:
    """Derive the right-hand outward normal of a CCW boundary edge."""

    if end.x_mm > start.x_mm:
        return Direction.SOUTH
    if end.x_mm < start.x_mm:
        return Direction.NORTH
    if end.y_mm > start.y_mm:
        return Direction.EAST
    if end.y_mm < start.y_mm:
        return Direction.WEST
    raise ValueError("Boundary edge has zero length")


def build_wall_segments(
    document: BuildingDocument, rooms: list[Room]
) -> tuple[list[WallSegment], list[Room]]:
    """Match every room boundary edge to exactly one covering source wall."""

    source_segments: dict[str, LineSegment] = {}
    for wall_id, wall in sorted(document.walls.items()):
        try:
            start_vertex = document.vertices[wall.start_vertex_id]
            end_vertex = document.vertices[wall.end_vertex_id]
        except KeyError as exc:
            raise ValueError(f"Wall {wall_id} references missing vertex {exc.args[0]}") from exc
        source_segments[wall_id] = LineSegment(
            start=Point2D(x_mm=start_vertex.x_mm, y_mm=start_vertex.y_mm),
            end=Point2D(x_mm=end_vertex.x_mm, y_mm=end_vertex.y_mm),
        )
    segments: list[WallSegment] = []
    updated_rooms: list[Room] = []
    for room in rooms:
        ids: list[str] = []
        for index, (start, end) in enumerate(
            zip(room.polygon, room.polygon[1:] + room.polygon[:1], strict=True)
        ):
            boundary = LineSegment(start=start, end=end)
            matches = [
                wall_id
                for wall_id, source in source_segments.items()
                if segment_covers(source, boundary)
            ]
            if len(matches) != 1:
                raise ValueError(
                    f"Room {room.id} boundary {index} matched {len(matches)} "
                    f"source walls: {matches}"
                )
            wall_id = matches[0]
            segment_id = f"{room.id}:{wall_id}:{index:03d}"
            ids.append(segment_id)
            segments.append(
                WallSegment(
                    id=segment_id,
                    source_wall_id=wall_id,
                    room_id=room.id,
                    segment=boundary,
                    global_direction=_outward_direction(start, end),
                    length_mm=boundary.length_mm,
                    boundary_index=index,
                )
            )
        updated_rooms.append(room.model_copy(update={"wall_segment_ids": ids}))
    return segments, updated_rooms
