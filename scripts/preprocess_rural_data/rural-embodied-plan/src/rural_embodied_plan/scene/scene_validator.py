"""Semantic integrity validation for navigation scenes."""

from collections import defaultdict, deque

from rural_embodied_plan.domain.navigation import NavigationScene, OpeningType


def validate_scene(scene: NavigationScene) -> list[str]:
    """Return semantic validation errors; an empty list means valid."""

    errors: list[str] = []
    room_ids = [room.id for room in scene.rooms]
    opening_ids = [opening.id for opening in scene.openings]
    if len(room_ids) != len(set(room_ids)):
        errors.append("Room IDs are not unique")
    if len(opening_ids) != len(set(opening_ids)):
        errors.append("Opening IDs are not unique")
    graph: dict[str, set[str]] = defaultdict(set)
    exterior_rooms: set[str] = set()
    exterior_window_rooms: set[str] = set()
    for opening in scene.openings:
        if opening.opening_type in {OpeningType.INTERIOR_DOOR, OpeningType.OPEN_PASSAGE}:
            if len(opening.room_ids) != 2 or opening.connects_outside:
                errors.append(f"Interior opening {opening.id} must connect two indoor rooms")
            elif len(opening.room_ids) == 2:
                left, right = opening.room_ids
                graph[left].add(right)
                graph[right].add(left)
        if opening.opening_type == OpeningType.EXTERIOR_DOOR:
            if len(opening.room_ids) != 1 or not opening.connects_outside:
                errors.append(f"Exterior door {opening.id} must connect one room and outside")
            else:
                exterior_rooms.add(opening.room_ids[0])
        if opening.opening_type == OpeningType.WINDOW and opening.connects_outside:
            exterior_window_rooms.update(opening.room_ids)
    reachable = set(exterior_rooms)
    queue = deque(sorted(exterior_rooms))
    while queue:
        room_id = queue.popleft()
        for neighbor in sorted(graph[room_id] - reachable):
            reachable.add(neighbor)
            queue.append(neighbor)
    missing = sorted(set(room_ids) - reachable - exterior_window_rooms)
    if missing:
        errors.append(
            "Rooms neither traversable from an exterior door nor observable through "
            f"an exterior window: {missing}"
        )
    for segment in scene.wall_segments:
        line = segment.segment
        if line.start.x_mm != line.end.x_mm and line.start.y_mm != line.end.y_mm:
            errors.append(f"Wall segment {segment.id} is not orthogonal")
    return errors
