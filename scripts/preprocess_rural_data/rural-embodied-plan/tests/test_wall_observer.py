"""Wall observation completeness tests."""

from rural_embodied_plan.domain.geometry import Direction
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.robot import ObservationType
from rural_embodied_plan.traversal.wall_observer import observe_room


def test_entry_front_left_right_observation_order(scene: NavigationScene) -> None:
    """Entry-wall components are activated before three explicit looks."""

    room = next(room for room in scene.rooms if room.id == "face_0002")
    observations = observe_room(scene, room, Direction.NORTH, "we_0001")
    assert [observation.type for observation in observations] == [
        ObservationType.ENTRY_WALL,
        ObservationType.WALL,
        ObservationType.WALL,
        ObservationType.WALL,
    ]
    assert observations[0].global_direction == Direction.SOUTH
    assert [opening.id for opening in observations[0].wall_segments[0].openings] == ["we_0001"]
