"""Behavior-time vocabulary and encoding tests."""

import re

from rural_embodied_plan.config import default_robot_config_path, load_robot_config
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.encoding.behavior_encoder import encode_behavior_tokens
from rural_embodied_plan.encoding.vocabulary import behavior_vocabulary
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


def test_behavior_actions_are_always_followed_by_duration_tokens(
    scene: NavigationScene,
) -> None:
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(_primary_component(scene), config)

    encoded = encode_behavior_tokens(trajectory, config, task_mode="pure_action")

    assert encoded.tokens[0] == "<BOS>"
    assert encoded.tokens[-1] == "<EOS>"
    for index, token in enumerate(encoded.tokens):
        if token.startswith("<ACT_"):
            assert encoded.tokens[index + 1].startswith("<DT_")


def test_behavior_tokens_use_global_ids_and_never_contain_source_ids(
    scene: NavigationScene,
) -> None:
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(_primary_component(scene), config)
    encoded = encode_behavior_tokens(trajectory, config, task_mode="action_perception")
    vocabulary = behavior_vocabulary(config)

    assert encoded.token_ids == [vocabulary.index(token) for token in encoded.tokens]
    assert any(token.startswith("<DOOR_") for token in encoded.tokens)
    joined = " ".join(encoded.tokens)
    assert trajectory.building_id not in joined
    assert re.search(r"(?:face_|we_|w_\d)", joined) is None


def test_action_target_precedes_duration_in_perception_view(
    scene: NavigationScene,
) -> None:
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(_primary_component(scene), config)
    tokens = encode_behavior_tokens(trajectory, config, task_mode="action_perception").tokens

    for action_token in (
        "<ACT_SELECT_EXTERIOR_DOOR>",
        "<ACT_SELECT_INTERIOR_DOOR>",
        "<ACT_CROSS_DOOR>",
    ):
        index = tokens.index(action_token)
        assert tokens[index + 1].startswith("<DOOR_")
        assert tokens[index + 2].startswith("<DT_")


def test_same_timed_trajectory_produces_byte_stable_behavior_tokens(
    scene: NavigationScene,
) -> None:
    config = load_robot_config(default_robot_config_path())
    trajectory = generate_timed_trajectory(_primary_component(scene), config)

    first = encode_behavior_tokens(trajectory, config, task_mode="action_perception")
    second = encode_behavior_tokens(trajectory, config, task_mode="action_perception")

    assert first.model_dump_json() == second.model_dump_json()
