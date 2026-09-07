"""Clockwise perimeter ordering of interior openings."""

from rural_embodied_plan.domain.geometry import Point2D
from rural_embodied_plan.domain.navigation import NavigationScene, OpeningType, Room


def _segment_length(start: Point2D, end: Point2D) -> int:
    return abs(end.x_mm - start.x_mm) + abs(end.y_mm - start.y_mm)


def _point_on_segment(point: Point2D, start: Point2D, end: Point2D) -> bool:
    if start.x_mm == end.x_mm == point.x_mm:
        return min(start.y_mm, end.y_mm) <= point.y_mm <= max(start.y_mm, end.y_mm)
    if start.y_mm == end.y_mm == point.y_mm:
        return min(start.x_mm, end.x_mm) <= point.x_mm <= max(start.x_mm, end.x_mm)
    return False


def _boundary_coordinate(polygon: list[Point2D], point: Point2D) -> tuple[int, int]:
    coordinate = 0
    perimeter = 0
    found: int | None = None
    for start, end in zip(polygon, polygon[1:] + polygon[:1], strict=True):
        length = _segment_length(start, end)
        if found is None and _point_on_segment(point, start, end):
            found = coordinate + _segment_length(start, point)
        coordinate += length
        perimeter += length
    if found is None:
        raise ValueError(f"Boundary point is not on room polygon: {point}")
    return found % perimeter, perimeter


def clockwise_boundary_distance(polygon: list[Point2D], start: Point2D, target: Point2D) -> int:
    """Return clockwise perimeter distance between two boundary points."""

    start_coordinate, perimeter = _boundary_coordinate(polygon, start)
    target_coordinate, target_perimeter = _boundary_coordinate(polygon, target)
    if target_perimeter != perimeter:
        raise ValueError("Inconsistent room perimeter")
    return (start_coordinate - target_coordinate) % perimeter


def ordered_interior_doors(scene: NavigationScene, room: Room, entry_door_id: str) -> list[str]:
    """Order traversable indoor openings clockwise from the entry opening."""

    opening_map = {opening.id: opening for opening in scene.openings}
    entry = opening_map[entry_door_id]
    candidate_ids = [
        opening_id
        for opening_id in room.opening_ids
        if opening_id != entry_door_id
        and opening_map[opening_id].opening_type
        in {OpeningType.INTERIOR_DOOR, OpeningType.OPEN_PASSAGE}
    ]
    ranked = sorted(
        candidate_ids,
        key=lambda opening_id: (
            clockwise_boundary_distance(room.polygon, entry.center, opening_map[opening_id].center),
            opening_map[opening_id].center.x_mm,
            opening_map[opening_id].center.y_mm,
            opening_map[opening_id].width_mm,
            opening_map[opening_id].opening_type.value,
        ),
    )
    geometry_keys = [
        (
            clockwise_boundary_distance(room.polygon, entry.center, opening_map[value].center),
            opening_map[value].center.x_mm,
            opening_map[value].center.y_mm,
            opening_map[value].width_mm,
            opening_map[value].opening_type.value,
        )
        for value in ranked
    ]
    if len(geometry_keys) != len(set(geometry_keys)):
        raise ValueError(f"Room {room.id} has geometrically indistinguishable frontier doors")
    return ranked
