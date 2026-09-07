"""ID-safe behavior-time views derived from canonical timed trajectories."""

from __future__ import annotations

import hashlib
import json
from bisect import bisect_left
from typing import Literal

from rural_embodied_plan.config import RobotConfig
from rural_embodied_plan.domain.tokens import BehaviorTokenSequence
from rural_embodied_plan.domain.trajectory import TimedTrajectory
from rural_embodied_plan.encoding.vocabulary import behavior_vocabulary
from rural_embodied_plan.timing import duration_bin_token


def _numeric_bin(prefix: str, value: int, boundaries: list[int]) -> str:
    if value < 0:
        raise ValueError(f"Cannot discretize negative {prefix} value")
    return f"<{prefix}_BIN_{bisect_left(boundaries, value):02d}>"


def _reference(value: object) -> str | None:
    if isinstance(value, str) and (
        value.startswith("ROOM_") or value.startswith("DOOR_") or value.startswith("OPENING_")
    ):
        return f"<{value}>"
    return None


def _trajectory_sha256(trajectory: TimedTrajectory) -> str:
    encoded = json.dumps(
        trajectory.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def encode_behavior_tokens(
    trajectory: TimedTrajectory,
    config: RobotConfig,
    *,
    task_mode: Literal["pure_action", "action_perception"] = "action_perception",
) -> BehaviorTokenSequence:
    """Encode physical behavior and optional minimal perception without source IDs."""

    tokens = ["<BOS>"]
    for event in trajectory.events:
        if event.action is not None:
            tokens.append(f"<ACT_{event.action.type.value}>")
            if task_mode == "action_perception":
                for value in (
                    event.action.door_local_id,
                    event.action.target_room_local_id,
                ):
                    reference = _reference(value)
                    if reference is not None:
                        tokens.append(reference)
            tokens.append(
                duration_bin_token(
                    event.timing.duration_ms,
                    config.tokenization.duration_bin_boundaries_ms,
                )
            )
        if task_mode != "action_perception" or event.observation is None:
            continue
        observation = event.observation
        tokens.append(f"<OBS_{observation.type.value}>")
        if observation.relative_direction is not None:
            tokens.append(f"<REL_{observation.relative_direction.value}>")
        for key in (
            "room_local_id",
            "entry_door_local_id",
            "door_local_id",
            "from_room_local_id",
            "to_room_local_id",
        ):
            reference = _reference(observation.data.get(key))
            if reference is not None:
                tokens.append(reference)
        for wall in observation.wall_segments:
            tokens.extend(
                [
                    "<WALL_BEGIN>",
                    _numeric_bin(
                        "LENGTH",
                        wall.length_mm,
                        config.tokenization.length_bin_boundaries_mm,
                    ),
                ]
            )
            for opening in wall.openings:
                tokens.extend(
                    [
                        "<OPENING_BEGIN>",
                        f"<TYPE_{opening.type}>",
                    ]
                )
                reference = _reference(opening.id)
                if reference is None:
                    raise ValueError("Observed opening is missing a trajectory-local ID")
                tokens.extend(
                    [
                        reference,
                        _numeric_bin(
                            "WIDTH",
                            opening.width_mm,
                            config.tokenization.width_bin_boundaries_mm,
                        ),
                        _numeric_bin(
                            "POSITION",
                            round(opening.normalized_position * 1000),
                            config.tokenization.position_bin_boundaries_per_mille,
                        ),
                        "<OPENING_END>",
                    ]
                )
            tokens.append("<WALL_END>")
    tokens.append("<EOS>")
    vocabulary = behavior_vocabulary(config)
    token_to_id = {token: index for index, token in enumerate(vocabulary)}
    missing = sorted(set(tokens) - set(token_to_id))
    if missing:
        raise ValueError(f"Behavior tokens are outside the fixed vocabulary: {missing}")
    return BehaviorTokenSequence(
        task_mode=task_mode,
        source_trajectory_sha256=_trajectory_sha256(trajectory),
        sample_id=trajectory.building_id,
        tokens=tokens,
        token_ids=[token_to_id[token] for token in tokens],
    )
