"""Schema-defined finite vocabulary, never inferred from a house's tokens."""

from rural_embodied_plan.v2.config import V2Config


def vocabulary(config: V2Config) -> list[str]:
    control = (
        "BOS EOS CODEC_V2 GLOBAL_SCAN_BEGIN GLOBAL_SCAN_END EPISODE_RESET "
        "EPISODE_BEGIN EPISODE_END ENTRY BUILDING_END"
    )
    fields = (
        "DOOR ROOM OPENING WALL EDGE NEW_HOST INTERVAL END_WALL TRUE FALSE "
        "STRING NULL POS NEG DEN END_INT DT_BEGIN DT_END"
    )
    actions = (
        "MOVE_FORWARD TURN_LEFT TURN_RIGHT TURN_BACK CROSS_DOOR EXIT_BUILDING "
        "LOOK_FRONT LOOK_LEFT LOOK_RIGHT SELECT_INTERIOR_DOOR STOP"
    )
    observations = (
        "EXTERIOR_DOOR ENTER_NEW_ROOM ENTER_VISITED_ROOM ENTRY_WALL WALL OPENING LOOP_CLOSURE"
    )
    tokens = [f"<{t}>" for t in (control + " " + fields).split()]
    tokens += [f"<ACT_{t}>" for t in actions.split()]
    tokens += [f"<OBS_{t}>" for t in observations.split()]
    tokens += [f"<DIGIT_{i}>" for i in range(10)] + [f"<BYTE_{i:02X}>" for i in range(256)]
    tokens += [f"<DT_BIN_{i:02d}>" for i in range(len(config.duration_bins_ms) + 1)]
    return sorted(tokens)
