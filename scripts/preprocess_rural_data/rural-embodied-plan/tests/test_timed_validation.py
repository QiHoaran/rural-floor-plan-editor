"""Canonical timed trajectory validation tests."""

from rural_embodied_plan.analysis.trajectory_statistics import validate_timed_trajectory
from rural_embodied_plan.config import default_robot_config_path, load_robot_config
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.robot import RobotActionType
from rural_embodied_plan.traversal.explorer import generate_timed_trajectory


def _primary_component(scene: NavigationScene) -> NavigationScene:
    room_ids = {"face_0001", "face_0002", "face_0003"}
    openings = [
        opening
        for opening in scene.openings
        if set(opening.room_ids).issubset(room_ids)
        and not (opening.connects_outside and opening.id != "we_0001")
    ]
    opening_ids = {opening.id for opening in openings}
    return scene.model_copy(
        update={
            "rooms": [
                room.model_copy(
                    update={
                        "opening_ids": [value for value in room.opening_ids if value in opening_ids]
                    }
                )
                for room in scene.rooms
                if room.id in room_ids
            ],
            "wall_segments": [
                segment.model_copy(
                    update={
                        "opening_ids": [
                            value for value in segment.opening_ids if value in opening_ids
                        ]
                    }
                )
                for segment in scene.wall_segments
                if segment.room_id in room_ids
            ],
            "openings": openings,
            "exterior_doors": ["we_0001"],
            "interior_doors": ["we_0008", "we_0009"],
            "room_adjacency": [
                value
                for value in scene.room_adjacency
                if value.opening_id in {"we_0008", "we_0009"}
            ],
        }
    )


def test_generated_timed_trajectory_satisfies_all_invariants(
    scene: NavigationScene,
) -> None:
    connected = _primary_component(scene)
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(connected, config)

    assert validate_timed_trajectory(connected, trajectory, config) == []


def test_validator_detects_timeline_discontinuity(scene: NavigationScene) -> None:
    connected = _primary_component(scene)
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(connected, config).model_copy(deep=True)
    trajectory.events[2].timing.start_ms += 1

    errors = validate_timed_trajectory(connected, trajectory, config)

    assert any("Timeline is not contiguous" in error for error in errors)


def test_validator_detects_move_duration_mismatch(scene: NavigationScene) -> None:
    connected = _primary_component(scene)
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(connected, config).model_copy(deep=True)
    move = next(
        event
        for event in trajectory.events
        if event.action is not None and event.action.type == RobotActionType.MOVE_FORWARD
    )
    move.timing.duration_ms += 1
    move.timing.end_ms += 1

    errors = validate_timed_trajectory(connected, trajectory, config)

    assert any("MOVE_FORWARD duration" in error for error in errors)


def test_validator_detects_room_reference_before_discovery(scene: NavigationScene) -> None:
    connected = _primary_component(scene)
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(connected, config).model_copy(deep=True)
    crossing_index = next(
        index
        for index, event in enumerate(trajectory.events)
        if event.action is not None and event.action.type == RobotActionType.CROSS_DOOR
    )
    crossing = trajectory.events[crossing_index]
    crossing.action.target_room_local_id = "ROOM_0"
    crossing.state_after.current_room_local_id = "ROOM_0"
    trajectory.events[crossing_index + 1].state_before.current_room_local_id = "ROOM_0"

    errors = validate_timed_trajectory(connected, trajectory, config)

    assert any("action exposes a room target" in error for error in errors)
    assert any("before ENTER_NEW_ROOM" in error for error in errors)
