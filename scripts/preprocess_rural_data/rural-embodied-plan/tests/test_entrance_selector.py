"""Exterior-door stable ordering tests."""

from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.traversal.entrance_selector import ordered_exterior_doors


def test_primary_door_follows_direction_then_coordinate_order(scene: NavigationScene) -> None:
    """Both south doors are ordered by centre x, selecting we_0001."""

    assert [door.id for door in ordered_exterior_doors(scene)] == ["we_0001", "we_0002"]
