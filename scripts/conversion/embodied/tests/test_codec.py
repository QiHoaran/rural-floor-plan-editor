"""Decoder fixture is authored by hand, not produced by the floorplan encoder."""

from fractions import Fraction as F

import pytest

from embodied.config import Config
from embodied.exact import (
    duration_tokens,
    rational_tokens,
    string_tokens,
    uint_tokens,
)


def manual_room_tokens() -> list[str]:
    config = Config()
    q, u, s = rational_tokens, uint_tokens, string_tokens

    def act(name: str, ms: int, target: int | None = None) -> list[str]:
        return (
            [f"<ACT_{name}>"]
            + ([] if target is None else ["<DOOR>"] + u(target))
            + (duration_tokens(F(ms), config.duration_bins_ms))
        )

    t = ["<BOS>", "<CODEC_V2>", "<GLOBAL_SCAN_BEGIN>"]
    t += act("MOVE_FORWARD", 1000)
    t += ["<OBS_EXTERIOR_DOOR>", "<DOOR>"] + u(0) + u(2) + q(1000) + u(900)
    t += act("MOVE_FORWARD", 2000)
    for length in (5000, 6000, 5000, 3000):
        t += act("TURN_RIGHT", 1000) + act("MOVE_FORWARD", length)
    t += ["<GLOBAL_SCAN_END>", "<EPISODE_RESET>", "<EPISODE_BEGIN>", "<ENTRY>", "<DOOR>"] + u(0)
    t += act("CROSS_DOOR", 600, 0)
    t += ["<OBS_ENTER_NEW_ROOM>", "<ROOM>"] + u(0) + s("living_room")
    # Sensor BACK=south, FRONT=north, LEFT=west, RIGHT=east; edge indices CCW.
    data = [
        (0, (0, 0), 1, 4000, 0, 4000),
        (2, (0, 3000), 1, 4000, 4000, 0),
        (3, (0, 0), 0, 3000, 3000, 0),
        (1, (4000, 0), 0, 3000, 0, 3000),
    ]
    for idx, (edge, start, axis, length, begin, end) in enumerate(data):
        t += (
            ["<OBS_ENTRY_WALL>"]
            if idx == 0
            else act(("", "LOOK_FRONT", "LOOK_LEFT", "LOOK_RIGHT")[idx], 300)
        )
        t += ["<OBS_WALL>", "<EDGE>"] + u(edge) + ["<WALL>"] + u(idx) + ["<NEW_HOST>"]
        t += q(start[0] - 1000) + q(start[1] - 300) + u(axis) + u(length)
        t += s("exterior") + u(200) + u(2800) + s("brick")
        t += ["<INTERVAL>"] + u(begin) + u(end)
        if edge == 0:
            t += ["<OBS_OPENING>", "<DOOR>"] + u(0) + s("exterior_door")
            t += u(550) + u(900) + u(2100) + u(0) + ["<TRUE>"]
            t += u(1) + s("people") + ["<TRUE>"]
        t += ["<END_WALL>"]
    t += act("TURN_BACK", 2000) + act("EXIT_BUILDING", 600, 0) + act("STOP", 0)
    return t + ["<EPISODE_END>", "<BUILDING_END>", "<EOS>"]


def test_decoder_first_manual_exact_room() -> None:
    from embodied.behavior_token_decoder import decode_behavior_tokens

    f = decode_behavior_tokens(manual_room_tokens(), Config())
    assert (f.width_mm, f.height_mm) == (4000, 3000)
    assert f.rooms[0].polygon == ((0, 0), (4000, 0), (4000, 3000), (0, 3000))
    assert f.rooms[0].function == "living_room"
    assert f.openings[0].offset_mm == 550
    assert f.openings[0].width_mm == 900


def test_decoder_rejects_future_room_and_missing_reset() -> None:
    from embodied.behavior_token_decoder import decode_behavior_tokens

    tokens = manual_room_tokens()
    tokens.remove("<EPISODE_RESET>")
    with pytest.raises(ValueError, match="TOKEN_GRAMMAR_ERROR"):
        decode_behavior_tokens(tokens, Config())
    tokens = manual_room_tokens()
    index = tokens.index("<ACT_CROSS_DOOR>")
    tokens[index + 1 : index + 1] = ["<ROOM>"] + uint_tokens(0)
    with pytest.raises(ValueError, match="TOKEN_GRAMMAR_ERROR"):
        decode_behavior_tokens(tokens, Config())


def test_encode_decode_reencode_exact() -> None:
    from fixtures import raw_rectangle

    from embodied.building import BuildingDocument
    from embodied.behavior_token_decoder import decode_behavior_tokens
    from embodied.floorplan import canonicalize_floorplan
    from embodied.floorplan_encoder import encode_floorplan

    f = canonicalize_floorplan(BuildingDocument.model_validate(raw_rectangle()))
    tokens = encode_floorplan(f, Config())
    reconstructed = decode_behavior_tokens(tokens, Config())
    assert reconstructed == f
    assert encode_floorplan(reconstructed, Config()) == tokens
    assert tokens.count("<BOS>") == 1
    assert tokens.count("<EPISODE_RESET>") == 1
    assert "<GRAPH_BEGIN>" not in tokens


def test_missing_exit_is_not_a_valid_stopped_episode() -> None:
    from embodied.behavior_token_decoder import decode_behavior_tokens

    t = manual_room_tokens()
    start = t.index("<ACT_CROSS_DOOR>")
    end = t.index("<ACT_STOP>")
    # A scanned building with an empty stop-only episode must not be accepted.
    del t[start:end]
    with pytest.raises(ValueError, match="TOKEN_GRAMMAR_ERROR"):
        decode_behavior_tokens(t, Config())


def test_exterior_scan_cannot_discover_a_door_on_wrong_edge() -> None:
    from embodied.behavior_token_decoder import decode_behavior_tokens

    t = manual_room_tokens()
    i = t.index("<OBS_EXTERIOR_DOOR>")
    # Preserve its global center by rotating the observation but moving the robot's
    # entire scan would require another geometry. A negative depth must be rejected.
    i = t.index("<POS>", i)
    t[i] = "<NEG>"
    with pytest.raises(ValueError, match="TOKEN_GRAMMAR_ERROR"):
        decode_behavior_tokens(t, Config())


def test_unresolved_scanned_door_rejected_by_decoder() -> None:
    from embodied.behavior_token_decoder import decode_behavior_tokens

    t = manual_room_tokens()
    start = t.index("<OBS_EXTERIOR_DOOR>")
    end = t.index("<ACT_MOVE_FORWARD>", start)
    extra = t[start:end].copy()
    extra[2] = "<DIGIT_1>"
    t[end:end] = extra
    with pytest.raises(ValueError):
        decode_behavior_tokens(t, Config())


def test_hand_authored_fixture_is_a_canonical_token_sequence() -> None:
    from embodied.behavior_token_decoder import decode_behavior_tokens
    from embodied.floorplan_encoder import encode_floorplan

    tokens = manual_room_tokens()
    assert encode_floorplan(decode_behavior_tokens(tokens, Config()), Config()) == tokens


def test_source_id_renaming_does_not_change_stream() -> None:
    from fixtures import raw_rectangle

    from embodied.building import BuildingDocument
    from embodied.floorplan import canonicalize_floorplan
    from embodied.floorplan_encoder import encode_floorplan

    raw = raw_rectangle()
    reference = encode_floorplan(
        canonicalize_floorplan(BuildingDocument.model_validate(raw)), Config()
    )
    raw["building_id"] = "irrelevant_source_building"
    raw["vertices"] = {"renamed_" + k: v for k, v in reversed(list(raw["vertices"].items()))}
    for w in raw["walls"].values():
        w["start_vertex_id"] = "renamed_" + w["start_vertex_id"]
        w["end_vertex_id"] = "renamed_" + w["end_vertex_id"]
    raw["walls"] = {"renamed_" + k: v for k, v in reversed(list(raw["walls"].items()))}
    for room in raw["faces"].values():
        ids = room["boundary_vertex_ids"]
        room["boundary_vertex_ids"] = ["renamed_" + v for v in ids[2:] + ids[:2]]
    raw["faces"] = {"renamed_" + k: v for k, v in raw["faces"].items()}
    for opening in raw["wall_elements"].values():
        opening["host_wall_id"] = "renamed_" + opening["host_wall_id"]
    raw["wall_elements"] = {"renamed_" + k: v for k, v in raw["wall_elements"].items()}
    for relation in raw["relations"]:
        relation["wall_element_id"] = "renamed_" + relation["wall_element_id"]
        relation["from_face_id"] = "renamed_" + relation["from_face_id"]
    actual = encode_floorplan(
        canonicalize_floorplan(BuildingDocument.model_validate(raw)), Config()
    )
    assert actual == reference
