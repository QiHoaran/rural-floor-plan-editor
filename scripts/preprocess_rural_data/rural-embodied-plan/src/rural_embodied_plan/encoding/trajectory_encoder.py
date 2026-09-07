"""Reversible readable Action-Observation trajectory encoding."""

from urllib.parse import quote

from rural_embodied_plan.config import ProjectConfig
from rural_embodied_plan.domain.robot import ObservationType, RobotActionType
from rural_embodied_plan.domain.tokens import TokenSequence
from rural_embodied_plan.domain.trajectory import Trajectory
from rural_embodied_plan.encoding.discretization import bin_token
from rural_embodied_plan.encoding.vocabulary import token_ids


def _value_token(prefix: str, value: str | int) -> str:
    return f"<{prefix}_{quote(str(value), safe='')} >".replace(" >", ">")


def encode_trajectory(
    trajectory: Trajectory,
    config: ProjectConfig,
    source_trajectory: str = "trajectory.json",
) -> TokenSequence:
    """Encode room graph metadata and the full action-observation event stream."""

    if len(trajectory.room_activations) > config.max_dynamic_rooms:
        raise ValueError("Trajectory exceeds configured dynamic room-token limit")
    observed_opening_ids = sorted(
        {
            opening.id
            for event in trajectory.events
            if event.observation is not None
            for wall in event.observation.wall_segments
            for opening in wall.openings
        }
    )
    if len(observed_opening_ids) > config.max_dynamic_doors:
        raise ValueError("Trajectory exceeds configured dynamic door-token limit")
    local_door_tokens = {
        opening_id: f"<DOOR_LOCAL_{index}>" for index, opening_id in enumerate(observed_opening_ids)
    }
    exterior_door_tokens = {
        activation.entry_door_id: f"<EXTERIOR_DOOR_{index}>"
        for index, activation in enumerate(
            sorted(
                (
                    value
                    for value in trajectory.room_activations
                    if value.depth == 0 and value.access_mode == "traversed"
                ),
                key=lambda value: value.entry_door_id,
            )
        )
    }
    dynamic_by_source = {
        activation.source_room_id: activation.dynamic_id
        for activation in trajectory.room_activations
    }
    tokens = ["<BOS>", "<BUILDING_BEGIN>"]
    tokens.extend(
        [
            _value_token("BUILDING", trajectory.building_id),
            _value_token("PRIMARY_EXTERIOR_DOOR", trajectory.primary_exterior_door_id),
            _value_token("LOOP_COUNT", trajectory.loop_closure_count),
            "<GRAPH_BEGIN>",
        ]
    )
    for activation in trajectory.room_activations:
        room_index = int(activation.dynamic_id.removeprefix("ROOM_"))
        tokens.extend(
            [
                "<ROOM_BEGIN>",
                f"<ROOM_NEW_{room_index}>",
                _value_token("FUNCTION", activation.function),
                bin_token("AREA", activation.area_mm2, config.discretization.area_mm2),
                bin_token("LENGTH", activation.east_west_size_mm, config.discretization.length_mm),
                bin_token(
                    "LENGTH", activation.north_south_size_mm, config.discretization.length_mm
                ),
                _value_token("DEPTH", activation.depth),
                _value_token("ENTRY_DOOR", activation.entry_door_id),
                _value_token("ACCESS_MODE", activation.access_mode),
                f"<DIR_{activation.entry_direction.value}>",
                "<ROOM_END>",
            ]
        )
    seen_edges: set[str] = set()
    for event in trajectory.events:
        action = event.action
        if (
            action is None
            or action.type != RobotActionType.SELECT_INTERIOR_DOOR
            or not action.door_id
        ):
            continue
        if action.door_id in seen_edges or not action.target_room_id:
            continue
        source_id = event.state_before.current_room_id
        if source_id is None:
            raise ValueError(f"Interior door selection {action.door_id} occurred outside")
        seen_edges.add(action.door_id)
        tokens.extend(
            [
                "<EDGE_BEGIN>",
                _value_token("DOOR", action.door_id),
                _value_token("FROM", dynamic_by_source[source_id]),
                _value_token("TO", dynamic_by_source[action.target_room_id]),
                "<EXTERIOR_FALSE>",
                "<EDGE_END>",
            ]
        )
    for activation in trajectory.room_activations:
        if activation.depth != 0 or activation.access_mode != "traversed":
            continue
        tokens.extend(
            [
                "<EDGE_BEGIN>",
                _value_token("DOOR", activation.entry_door_id),
                _value_token("FROM", activation.dynamic_id),
                _value_token("TO", "OUTSIDE"),
                "<EXTERIOR_TRUE>",
                "<EDGE_END>",
            ]
        )
    direction_records: set[tuple[str, str]] = set()
    for event in trajectory.events:
        observation = event.observation
        if observation is None or observation.global_direction is None:
            continue
        for wall in observation.wall_segments:
            for opening in wall.openings:
                direction_records.add((opening.id, observation.global_direction.value))
    for opening_id, direction in sorted(direction_records):
        tokens.extend(
            [
                "<OPENING_DIRECTION_BEGIN>",
                _value_token("OPENING", opening_id),
                f"<DIR_{direction}>",
                "<OPENING_DIRECTION_END>",
            ]
        )
    tokens.extend(["<GRAPH_END>"])
    for event in trajectory.events:
        if event.action is not None:
            tokens.append(f"<ACT_{event.action.type.value}>")
            if event.action.distance_mm is not None:
                tokens.append(
                    bin_token(
                        "DISTANCE", event.action.distance_mm, config.discretization.distance_mm
                    )
                )
            if event.action.door_id:
                tokens.append(_value_token("DOOR_REF", event.action.door_id))
        if event.observation is not None:
            tokens.append(f"<OBS_{event.observation.type.value}>")
            if event.observation.relative_direction is not None:
                tokens.append(f"<REL_{event.observation.relative_direction.value}>")
            if event.observation.global_direction is not None:
                tokens.append(f"<DIR_{event.observation.global_direction.value}>")
            if event.observation.type == ObservationType.ENTER_VISITED_ROOM:
                dynamic = str(event.observation.data.get("dynamic_room_id", "ROOM_REF_UNKNOWN"))
                tokens.append(f"<{dynamic}>")
            for wall in event.observation.wall_segments:
                tokens.extend(
                    [
                        "<WALL_BEGIN>",
                        bin_token("LENGTH", wall.length_mm, config.discretization.length_mm),
                    ]
                )
                for opening in wall.openings:
                    observation_token = {
                        "EXTERIOR_DOOR": "<OBS_DOOR>",
                        "INTERIOR_DOOR": "<OBS_DOOR>",
                        "WINDOW": "<OBS_WINDOW>",
                        "OPEN_PASSAGE": "<OBS_OPEN_PASSAGE>",
                    }[opening.type]
                    tokens.extend(
                        [
                            observation_token,
                            local_door_tokens[opening.id],
                            exterior_door_tokens.get(
                                opening.id, _value_token("OPENING_REF", opening.id)
                            ),
                            bin_token("WIDTH", opening.width_mm, config.discretization.width_mm),
                            bin_token(
                                "POSITION",
                                round(opening.normalized_position * 1000),
                                config.discretization.position_per_mille,
                            ),
                        ]
                    )
                tokens.append("<WALL_END>")
    tokens.extend(["<BUILDING_END>", "<EOS>"])
    return TokenSequence(
        tokens=tokens,
        token_ids=token_ids(tokens),
        source_trajectory=source_trajectory,
    )
