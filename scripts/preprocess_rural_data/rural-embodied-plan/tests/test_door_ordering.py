"""Clockwise interior-door ordering tests."""

from rural_embodied_plan.domain.geometry import Point2D
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.traversal.door_ordering import (
    clockwise_boundary_distance,
    ordered_interior_doors,
)


def test_doors_are_clockwise_from_entry_wall(scene: NavigationScene) -> None:
    """The west door precedes the east door from the south entry wall."""

    room = next(room for room in scene.rooms if room.id == "face_0002")
    assert ordered_interior_doors(scene, room, "we_0001") == ["we_0008", "we_0009"]


def test_door_order_is_independent_of_wall_segment_storage_order(
    scene: NavigationScene,
) -> None:
    room = next(room for room in scene.rooms if room.id == "face_0002")
    reordered = room.model_copy(update={"wall_segment_ids": list(reversed(room.wall_segment_ids))})

    assert ordered_interior_doors(scene, reordered, "we_0001") == ["we_0008", "we_0009"]


def test_clockwise_distance_uses_opening_position_on_entry_wall() -> None:
    polygon = [
        Point2D(x_mm=0, y_mm=0),
        Point2D(x_mm=4000, y_mm=0),
        Point2D(x_mm=4000, y_mm=3000),
        Point2D(x_mm=0, y_mm=3000),
    ]
    entry = Point2D(x_mm=2000, y_mm=3000)
    clockwise_neighbor = Point2D(x_mm=3000, y_mm=3000)
    counterclockwise_neighbor = Point2D(x_mm=1000, y_mm=3000)

    assert clockwise_boundary_distance(polygon, entry, clockwise_neighbor) == 1000
    assert clockwise_boundary_distance(polygon, entry, counterclockwise_neighbor) == 13000
