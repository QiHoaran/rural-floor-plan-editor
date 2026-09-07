"""DFS exploration completeness tests."""

from rural_embodied_plan.analysis.trajectory_statistics import validate_trajectory
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.robot import RobotActionType
from rural_embodied_plan.domain.trajectory import Trajectory


def test_explorer_visits_all_components_and_returns_outside(
    scene: NavigationScene, trajectory: Trajectory
) -> None:
    """All rooms and interior doors are handled and STOP occurs outside."""

    assert validate_trajectory(scene, trajectory) == []
    assert trajectory.visited_room_ids == [
        "face_0002",
        "face_0001",
        "face_0003",
        "face_0004",
        "face_0005",
    ]
    assert trajectory.processed_interior_door_ids == ["we_0008", "we_0009", "we_0010"]
    assert trajectory.events[-1].action is not None
    assert trajectory.events[-1].action.type == RobotActionType.STOP
    assert trajectory.events[-1].state_after.current_room_id is None
