"""Load validated pipeline outputs and align trajectory events with tokens."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import ValidationError

from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.robot import ObservationType
from rural_embodied_plan.domain.tokens import TokenSequence
from rural_embodied_plan.domain.trajectory import Trajectory, TrajectoryEvent
from rural_embodied_plan.io.json_writer import read_json


class PlaybackSessionError(ValueError):
    """Raised when pipeline artifacts cannot form a consistent playback session."""


def _unique_index(tokens: list[str], value: str) -> int:
    matches = [index for index, token in enumerate(tokens) if token == value]
    if len(matches) != 1:
        raise PlaybackSessionError(f"Expected exactly one {value} token, found {len(matches)}")
    return matches[0]


def _consume_exact(tokens: list[str], cursor: int, expected: str, step: int) -> int:
    if cursor >= len(tokens) or tokens[cursor] != expected:
        actual = tokens[cursor] if cursor < len(tokens) else "<END_OF_SEQUENCE>"
        raise PlaybackSessionError(
            f"Token/trajectory mismatch at event {step}: expected {expected}, found {actual}"
        )
    return cursor + 1


def _consume_any(tokens: list[str], cursor: int, step: int, description: str) -> int:
    if cursor >= len(tokens) or tokens[cursor] == "<BUILDING_END>":
        raise PlaybackSessionError(
            f"Token/trajectory mismatch at event {step}: missing {description} token"
        )
    return cursor + 1


def _consume_event(tokens: list[str], cursor: int, event: TrajectoryEvent) -> int:
    action = event.action
    if action is not None:
        cursor = _consume_exact(tokens, cursor, f"<ACT_{action.type.value}>", event.step)
        if action.distance_mm is not None:
            cursor = _consume_any(tokens, cursor, event.step, "distance bin")
        if action.door_id:
            cursor = _consume_exact(tokens, cursor, f"<DOOR_REF_{action.door_id}>", event.step)

    observation = event.observation
    if observation is None:
        return cursor
    cursor = _consume_exact(tokens, cursor, f"<OBS_{observation.type.value}>", event.step)
    if observation.relative_direction is not None:
        cursor = _consume_exact(
            tokens, cursor, f"<REL_{observation.relative_direction.value}>", event.step
        )
    if observation.global_direction is not None:
        cursor = _consume_exact(
            tokens, cursor, f"<DIR_{observation.global_direction.value}>", event.step
        )
    if observation.type == ObservationType.ENTER_VISITED_ROOM:
        dynamic_id = str(observation.data.get("dynamic_room_id", "ROOM_REF_UNKNOWN"))
        cursor = _consume_exact(tokens, cursor, f"<{dynamic_id}>", event.step)
    opening_tokens = {
        "EXTERIOR_DOOR": "<OBS_DOOR>",
        "INTERIOR_DOOR": "<OBS_DOOR>",
        "WINDOW": "<OBS_WINDOW>",
        "OPEN_PASSAGE": "<OBS_OPEN_PASSAGE>",
    }
    for wall in observation.wall_segments:
        cursor = _consume_exact(tokens, cursor, "<WALL_BEGIN>", event.step)
        cursor = _consume_any(tokens, cursor, event.step, "wall length bin")
        for opening in wall.openings:
            cursor = _consume_exact(tokens, cursor, opening_tokens[opening.type], event.step)
            cursor = _consume_any(tokens, cursor, event.step, "local opening reference")
            cursor = _consume_any(tokens, cursor, event.step, "opening reference")
            cursor = _consume_any(tokens, cursor, event.step, "opening width bin")
            cursor = _consume_any(tokens, cursor, event.step, "opening position bin")
        cursor = _consume_exact(tokens, cursor, "<WALL_END>", event.step)
    return cursor


def event_token_spans(
    trajectory: Trajectory, sequence: TokenSequence
) -> tuple[list[int], list[dict[str, int]]]:
    """Return graph bounds and left-closed/right-open token spans for every event."""

    tokens = sequence.tokens
    graph_begin = _unique_index(tokens, "<GRAPH_BEGIN>")
    graph_end = _unique_index(tokens, "<GRAPH_END>")
    building_end = _unique_index(tokens, "<BUILDING_END>")
    if not graph_begin < graph_end < building_end:
        raise PlaybackSessionError("Token graph and building delimiters are out of order")
    cursor = graph_end + 1
    spans: list[dict[str, int]] = []
    for event in trajectory.events:
        start = cursor
        cursor = _consume_event(tokens, cursor, event)
        spans.append({"step": event.step, "start": start, "end": cursor})
    if cursor != building_end:
        actual = tokens[cursor] if cursor < len(tokens) else "<END_OF_SEQUENCE>"
        raise PlaybackSessionError(
            "Token/trajectory mismatch after final event: "
            f"expected <BUILDING_END>, found {actual} at index {cursor}"
        )
    return [graph_begin, graph_end + 1], spans


def _load_model(
    path: Path,
    model: type[NavigationScene] | type[Trajectory] | type[TokenSequence],
) -> Any:
    try:
        return model.model_validate(read_json(path))
    except FileNotFoundError as error:
        raise PlaybackSessionError(f"Missing required pipeline file: {path.name}") from error
    except (OSError, ValueError, ValidationError) as error:
        raise PlaybackSessionError(f"Invalid {path.name}: {error}") from error


def build_playback_session(output_dir: Path) -> dict[str, Any]:
    """Build a JSON-ready playback session from one pipeline output directory."""

    directory = output_dir.resolve()
    if not directory.is_dir():
        raise PlaybackSessionError(f"Pipeline output directory does not exist: {output_dir}")
    scene = _load_model(directory / "navigation_scene.json", NavigationScene)
    trajectory = _load_model(directory / "trajectory.json", Trajectory)
    sequence = _load_model(directory / "tokens.json", TokenSequence)
    if scene.building_id != trajectory.building_id:
        raise PlaybackSessionError("Scene and trajectory building_id values do not match")
    graph_range, spans = event_token_spans(trajectory, sequence)
    return {
        "scene": scene.model_dump(mode="json"),
        "trajectory": trajectory.model_dump(mode="json"),
        "tokens": sequence.model_dump(mode="json"),
        "graph_token_range": graph_range,
        "event_token_spans": spans,
    }
