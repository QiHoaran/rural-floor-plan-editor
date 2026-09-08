"""Independent decode, exact field comparison, and deterministic re-encode gate."""

from typing import Any

from embodied.behavior_token_decoder import Decoder
from embodied.config import Config
from embodied.floorplan import CanonicalFloorplan, canonicalize_floorplan
from embodied.floorplan_encoder import encode_floorplan


def validate_roundtrip(
    floorplan: CanonicalFloorplan, tokens: list[str], config: Config
) -> tuple[CanonicalFloorplan, list[dict[str, Any]], dict[str, Any]]:
    expected = canonicalize_floorplan(floorplan)
    decoder = Decoder(tokens, config)
    reconstructed = decoder.decode()
    if expected != reconstructed:
        different = [
            key
            for key in expected.model_dump()
            if expected.model_dump()[key] != reconstructed.model_dump()[key]
        ]
        raise ValueError(f"FLOORPLAN_ROUNDTRIP_MISMATCH: {','.join(different)}")
    # No original token cache, scene, trajectory, or source map reaches the encoder.
    reencoded = encode_floorplan(reconstructed, config)
    if tokens != reencoded:
        first = next(
            (i for i, (a, b) in enumerate(zip(tokens, reencoded, strict=False)) if a != b),
            min(len(tokens), len(reencoded)),
        )
        raise ValueError(f"NON_DETERMINISTIC_REENCODE: token {first}")
    if encode_floorplan(expected, config) != tokens:
        raise ValueError("NON_DETERMINISTIC_REENCODE: repeated encoding differs")
    for left, right in zip(decoder.events, decoder.events[1:], strict=False):
        if left["session"] != right["session"]:
            continue
        if left["state_after"] != right["state_before"] or left["end_ms"] != right["start_ms"]:
            raise ValueError("PATH_INVALID: replay timeline is discontinuous")
    report = {
        "status": "valid",
        "roundtrip_exact": True,
        "floorplan_roundtrip_exact": True,
        "token_roundtrip_exact": True,
        "deterministic_reencode": True,
        "physical_replay": "passed_nominal_2d_geometry",
        "outdoor_environment_validation": "not_available",
        "policy_version": config.policy_version,
        "vocabulary_version": config.vocabulary_version,
        "room_count": len(expected.rooms),
        "wall_count": len(expected.walls),
        "opening_count": len(expected.openings),
        "door_count": sum(
            o.opening_type in {"exterior_door", "interior_door"} for o in expected.openings
        ),
        "window_count": sum(o.opening_type == "exterior_window" for o in expected.openings),
        "component_count": tokens.count("<EPISODE_BEGIN>"),
        "token_count": len(tokens),
        "event_count": len(decoder.events),
        "loop_count": tokens.count("<OBS_LOOP_CLOSURE>"),
        "bbox_mm": [expected.width_mm, expected.height_mm],
        "normalization_scope": (
            "canonical-floorplan/2; normalized translation; editor metadata excluded"
        ),
    }
    return reconstructed, decoder.events, report
