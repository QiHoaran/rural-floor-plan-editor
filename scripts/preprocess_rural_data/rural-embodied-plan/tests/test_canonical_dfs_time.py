"""Canonical timed DFS policy tests."""

from pathlib import Path
from editor_samples import sample_path

import pytest

from rural_embodied_plan.config import (
    default_robot_config_path,
    load_config,
    load_robot_config,
)
from rural_embodied_plan.domain.geometry import Point2D
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.robot import ObservationType, RobotActionType
from rural_embodied_plan.geometry.directions import opposite, vector
from rural_embodied_plan.io.building_loader import load_building
from rural_embodied_plan.scene.scene_builder import build_scene
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
    rooms = [
        room.model_copy(
            update={"opening_ids": [value for value in room.opening_ids if value in opening_ids]}
        )
        for room in scene.rooms
        if room.id in room_ids
    ]
    segments = [
        segment.model_copy(
            update={"opening_ids": [value for value in segment.opening_ids if value in opening_ids]}
        )
        for segment in scene.wall_segments
        if segment.room_id in room_ids
    ]
    return scene.model_copy(
        update={
            "rooms": rooms,
            "wall_segments": segments,
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


def _configured_anchor(scene: NavigationScene, opening_id: str, room_id: str) -> Point2D:
    config = load_robot_config(default_robot_config_path())
    opening = next(value for value in scene.openings if value.id == opening_id)
    outward = opening.global_directions[room_id]
    dx, dy = vector(opposite(outward))
    return Point2D(
        x_mm=opening.center.x_mm + dx * config.geometry.door_anchor_offset_mm,
        y_mm=opening.center.y_mm + dy * config.geometry.door_anchor_offset_mm,
    )


def test_child_return_routes_directly_from_child_door_to_next_sibling(
    scene: NavigationScene,
) -> None:
    connected = _primary_component(scene)
    config = load_robot_config(default_robot_config_path())

    trajectory = generate_timed_trajectory(connected, config)
    source_to_local = {source: local for local, source in trajectory.local_id_map.openings.items()}
    second_door = source_to_local["we_0009"]
    selection = next(
        event
        for event in trajectory.events
        if event.action is not None
        and event.action.type == RobotActionType.SELECT_INTERIOR_DOOR
        and event.action.door_local_id == second_door
    )

    assert selection.state_before.position == _configured_anchor(connected, "we_0008", "face_0002")
    assert selection.state_before.position != _configured_anchor(connected, "we_0001", "face_0002")
    assert all(
        event.action is None or event.action.type != RobotActionType.BACKTRACK
        for event in trajectory.events
    )


def test_room_local_id_is_first_allocated_by_enter_new_room(
    scene: NavigationScene,
) -> None:
    trajectory = generate_timed_trajectory(
        _primary_component(scene), load_robot_config(default_robot_config_path())
    )

    for event in trajectory.events:
        if event.action is not None and event.action.type in {
            RobotActionType.SELECT_EXTERIOR_DOOR,
            RobotActionType.SELECT_INTERIOR_DOOR,
            RobotActionType.CROSS_DOOR,
            RobotActionType.EXIT_BUILDING,
        }:
            assert event.action.target_room_local_id is None

    for index, event in enumerate(trajectory.events):
        if event.observation is None or event.observation.type != ObservationType.ENTER_NEW_ROOM:
            continue
        room_local_id = event.observation.data["room_local_id"]
        prior_events = "".join(previous.model_dump_json() for previous in trajectory.events[:index])
        assert room_local_id not in prior_events
        assert event.state_before.current_room_local_id is None
        assert event.state_after.current_room_local_id == room_local_id


def test_disconnected_primary_component_is_rejected_without_teleport(
    scene: NavigationScene,
) -> None:
    config = load_robot_config(default_robot_config_path())

    with pytest.raises(ValueError, match="primary exterior door component"):
        generate_timed_trajectory(scene, config)


def test_door_narrower_than_robot_clearance_is_rejected(scene: NavigationScene) -> None:
    connected = _primary_component(scene)
    connected = connected.model_copy(
        update={
            "openings": [
                opening.model_copy(update={"width_mm": 400}) if opening.id == "we_0008" else opening
                for opening in connected.openings
            ]
        }
    )

    with pytest.raises(ValueError, match="narrower than required robot clearance"):
        generate_timed_trajectory(connected, load_robot_config(default_robot_config_path()))


def test_loop_closure_turns_back_physically_before_crossing_back() -> None:
    raw = sample_path("rural_002_house_0082")
    project_config = load_config(
        Path(__file__).resolve().parents[1] / "examples/sample_config.yaml"
    )
    scene = build_scene(load_building(raw), project_config)
    trajectory = generate_timed_trajectory(scene, load_robot_config(default_robot_config_path()))

    loop_indexes = [
        index
        for index, event in enumerate(trajectory.events)
        if event.observation is not None and event.observation.type.value == "LOOP_CLOSURE"
    ]
    assert len(loop_indexes) == 2
    for index in loop_indexes:
        crossing = next(
            offset
            for offset in range(index + 1, len(trajectory.events))
            if trajectory.events[offset].action is not None
            and trajectory.events[offset].action.type == RobotActionType.CROSS_DOOR
        )
        turns = [
            event
            for event in trajectory.events[index + 1 : crossing]
            if event.action is not None and event.action.type == RobotActionType.TURN_BACK
        ]
        assert len(turns) == 1
        assert turns[0].timing.duration_ms == 2000
