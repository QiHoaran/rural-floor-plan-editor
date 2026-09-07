"""Deterministic entry-wall and three-direction room observation."""

from rural_embodied_plan.domain.geometry import Direction, RelativeDirection
from rural_embodied_plan.domain.navigation import NavigationScene, Opening, Room, WallSegment
from rural_embodied_plan.domain.robot import (
    Observation,
    ObservationType,
    ObservedOpening,
    ObservedWallSegment,
)
from rural_embodied_plan.geometry.directions import opposite, turn


def _wall_observation(
    relative: RelativeDirection,
    global_direction: Direction,
    segments: list[WallSegment],
    openings: dict[str, Opening],
    entry: bool,
) -> Observation:
    observed_segments = []
    for segment in sorted(segments, key=lambda value: (value.boundary_index, value.id)):
        observed_segments.append(
            ObservedWallSegment(
                id=segment.id,
                length_mm=segment.length_mm,
                openings=[
                    ObservedOpening(
                        id=opening_id,
                        type=openings[opening_id].opening_type.value,
                        center=openings[opening_id].center,
                        width_mm=openings[opening_id].width_mm,
                        normalized_position=openings[opening_id].normalized_position,
                    )
                    for opening_id in segment.opening_ids
                ],
            )
        )
    return Observation(
        type=ObservationType.ENTRY_WALL if entry else ObservationType.WALL,
        relative_direction=relative,
        global_direction=global_direction,
        wall_segments=observed_segments,
    )


def observe_room(
    scene: NavigationScene, room: Room, heading: Direction, entry_door_id: str
) -> list[Observation]:
    """Observe entry wall, front, left, and right in the mandated order."""

    segment_map = {segment.id: segment for segment in scene.wall_segments}
    opening_map = {opening.id: opening for opening in scene.openings}
    entry = opening_map[entry_door_id]
    entry_global = entry.global_directions[room.id]
    groups: dict[Direction, list[WallSegment]] = {direction: [] for direction in Direction}
    for segment_id in room.wall_segment_ids:
        segment = segment_map[segment_id]
        groups[segment.global_direction].append(segment)
    result = [
        _wall_observation(
            RelativeDirection.BACK,
            entry_global,
            groups[entry_global],
            opening_map,
            True,
        )
    ]
    for relative in (RelativeDirection.FRONT, RelativeDirection.LEFT, RelativeDirection.RIGHT):
        global_direction = turn(heading, relative)
        result.append(
            _wall_observation(
                relative,
                global_direction,
                groups[global_direction],
                opening_map,
                False,
            )
        )
    if opposite(entry_global) != heading:
        raise ValueError(
            f"Room {room.id} entry heading {heading} is inconsistent with wall {entry_global}"
        )
    return result
