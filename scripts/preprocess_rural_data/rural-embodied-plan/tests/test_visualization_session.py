"""Playback-session validation and event/token alignment tests."""

from pathlib import Path

import pytest

from rural_embodied_plan.config import ProjectConfig
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.tokens import TokenSequence
from rural_embodied_plan.domain.trajectory import Trajectory
from rural_embodied_plan.encoding.trajectory_encoder import encode_trajectory
from rural_embodied_plan.io.json_writer import write_json
from rural_embodied_plan.visualization.session import (
    PlaybackSessionError,
    build_playback_session,
    event_token_spans,
)


def _write_pipeline_outputs(
    directory: Path,
    scene: NavigationScene,
    trajectory: Trajectory,
    tokens: TokenSequence,
) -> None:
    write_json(directory / "navigation_scene.json", scene)
    write_json(directory / "trajectory.json", trajectory)
    write_json(directory / "tokens.json", tokens)


def test_event_token_spans_cover_action_observation_stream(
    trajectory: Trajectory, config: ProjectConfig
) -> None:
    sequence = encode_trajectory(trajectory, config)
    graph_range, spans = event_token_spans(trajectory, sequence)
    graph_end = sequence.tokens.index("<GRAPH_END>")
    building_end = sequence.tokens.index("<BUILDING_END>")

    assert graph_range == [sequence.tokens.index("<GRAPH_BEGIN>"), graph_end + 1]
    assert len(spans) == len(trajectory.events)
    assert spans[0]["start"] == graph_end + 1
    assert spans[-1]["end"] == building_end
    assert [span["step"] for span in spans] == list(range(len(trajectory.events)))
    assert all(left["end"] == right["start"] for left, right in zip(spans, spans[1:], strict=False))

    combined = [token for span in spans for token in sequence.tokens[span["start"] : span["end"]]]
    assert "<ACT_MOVE_FORWARD>" in combined
    assert "<ACT_SELECT_INTERIOR_DOOR>" in combined
    assert "<OBS_WALL>" in combined
    assert "<OBS_DOOR>" in combined
    assert "<OBS_WINDOW>" in combined


def test_event_token_spans_reject_mismatched_sequence(
    trajectory: Trajectory, config: ProjectConfig
) -> None:
    sequence = encode_trajectory(trajectory, config)
    graph_end = sequence.tokens.index("<GRAPH_END>")
    sequence.tokens[graph_end + 1] = "<ACT_STOP>"

    with pytest.raises(PlaybackSessionError, match="event 0"):
        event_token_spans(trajectory, sequence)


def test_build_playback_session_loads_validated_outputs(
    tmp_path: Path,
    scene: NavigationScene,
    trajectory: Trajectory,
    config: ProjectConfig,
) -> None:
    sequence = encode_trajectory(trajectory, config)
    _write_pipeline_outputs(tmp_path, scene, trajectory, sequence)

    session = build_playback_session(tmp_path)

    assert session["scene"]["building_id"] == scene.building_id
    assert len(session["event_token_spans"]) == len(trajectory.events)
    assert session["tokens"]["tokens"][-1] == "<EOS>"


def test_build_playback_session_reports_missing_file(tmp_path: Path) -> None:
    with pytest.raises(PlaybackSessionError, match="navigation_scene.json"):
        build_playback_session(tmp_path)


def test_build_playback_session_reports_invalid_json(tmp_path: Path) -> None:
    (tmp_path / "navigation_scene.json").write_text("not json", encoding="utf-8")
    with pytest.raises(PlaybackSessionError, match="Invalid navigation_scene.json"):
        build_playback_session(tmp_path)
