"""Stable exterior-door selection."""

from rural_embodied_plan.domain.geometry import Direction
from rural_embodied_plan.domain.navigation import NavigationScene, Opening, OpeningType

_DIRECTION_RANK = {
    Direction.NORTH: 0,
    Direction.EAST: 1,
    Direction.SOUTH: 2,
    Direction.WEST: 3,
}


def ordered_exterior_doors(scene: NavigationScene) -> list[Opening]:
    """Sort exterior doors by global wall direction then centre coordinates."""

    doors = [
        opening for opening in scene.openings if opening.opening_type == OpeningType.EXTERIOR_DOOR
    ]
    if not doors:
        raise ValueError("Scene has no exterior door")
    return sorted(
        doors,
        key=lambda opening: (
            _DIRECTION_RANK[opening.global_directions[opening.room_ids[0]]],
            opening.center.x_mm,
            opening.center.y_mm,
            opening.id,
        ),
    )


def select_primary_exterior_door(scene: NavigationScene) -> Opening:
    """Return the first exterior door under the documented stable ordering."""

    return ordered_exterior_doors(scene)[0]
