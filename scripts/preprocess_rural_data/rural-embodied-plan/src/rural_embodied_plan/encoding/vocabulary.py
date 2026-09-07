"""Versioned fixed and dynamic token-to-ID vocabulary."""

from rural_embodied_plan.config import RobotConfig
from rural_embodied_plan.domain.robot import ObservationType, RobotActionType

CONTROL_TOKENS = [
    "<BOS>",
    "<EOS>",
    "<BUILDING_BEGIN>",
    "<BUILDING_END>",
    "<ROOM_BEGIN>",
    "<ROOM_END>",
    "<WALL_BEGIN>",
    "<WALL_END>",
]

ACTION_TOKENS = [
    f"<ACT_{name}>"
    for name in [
        "SELECT_EXTERIOR_DOOR",
        "SELECT_EXTERIOR_WINDOW",
        "SELECT_INTERIOR_DOOR",
        "CROSS_DOOR",
        "LOOK_FRONT",
        "LOOK_LEFT",
        "LOOK_RIGHT",
        "MOVE_FORWARD",
        "TURN_LEFT",
        "TURN_RIGHT",
        "TURN_BACK",
        "BACKTRACK",
        "EXIT_BUILDING",
        "STOP",
    ]
]

OBSERVATION_TOKENS = [
    f"<OBS_{name}>"
    for name in [
        "OUTSIDE",
        "AT_DOOR",
        "EXTERIOR_WINDOW_VIEW",
        "ENTER_NEW_ROOM",
        "ENTER_VISITED_ROOM",
        "ENTRY_WALL",
        "WALL",
        "DOOR",
        "WINDOW",
        "OPEN_PASSAGE",
        "SECONDARY_EXTERIOR_DOOR",
        "LOOP_CLOSURE",
        "DEAD_END",
    ]
]

DIRECTION_TOKENS = [
    "<DIR_NORTH>",
    "<DIR_EAST>",
    "<DIR_SOUTH>",
    "<DIR_WEST>",
    "<REL_FRONT>",
    "<REL_LEFT>",
    "<REL_RIGHT>",
    "<REL_BACK>",
]

METADATA_TOKENS = [
    "<GRAPH_BEGIN>",
    "<GRAPH_END>",
    "<EDGE_BEGIN>",
    "<EDGE_END>",
    "<OPENING_DIRECTION_BEGIN>",
    "<OPENING_DIRECTION_END>",
    "<EXTERIOR_TRUE>",
    "<EXTERIOR_FALSE>",
]

FIXED_TOKENS = (
    CONTROL_TOKENS + ACTION_TOKENS + OBSERVATION_TOKENS + DIRECTION_TOKENS + METADATA_TOKENS
)


def token_ids(tokens: list[str]) -> list[int]:
    """Assign stable IDs: fixed vocabulary first, sorted sample-dynamic tokens next."""

    dynamic = sorted(set(tokens) - set(FIXED_TOKENS))
    vocabulary = {token: index for index, token in enumerate([*FIXED_TOKENS, *dynamic])}
    return [vocabulary[token] for token in tokens]


def behavior_vocabulary(config: RobotConfig) -> list[str]:
    """Return the complete corpus-wide behavior-time vocabulary."""

    control = [
        "<BOS>",
        "<EOS>",
        "<WALL_BEGIN>",
        "<WALL_END>",
        "<OPENING_BEGIN>",
        "<OPENING_END>",
    ]
    actions = [
        f"<ACT_{action.value}>" for action in RobotActionType if action != RobotActionType.BACKTRACK
    ]
    observations = [f"<OBS_{observation.value}>" for observation in ObservationType]
    relatives = ["<REL_FRONT>", "<REL_LEFT>", "<REL_RIGHT>", "<REL_BACK>"]
    opening_types = [
        "<TYPE_EXTERIOR_DOOR>",
        "<TYPE_INTERIOR_DOOR>",
        "<TYPE_WINDOW>",
        "<TYPE_OPEN_PASSAGE>",
    ]
    duration_count = len(config.tokenization.duration_bin_boundaries_ms)
    durations = [f"<DT_{index:02d}>" for index in range(duration_count)] + ["<DT_OVERFLOW>"]
    lengths = [
        f"<LENGTH_BIN_{index:02d}>"
        for index in range(len(config.tokenization.length_bin_boundaries_mm) + 1)
    ]
    widths = [
        f"<WIDTH_BIN_{index:02d}>"
        for index in range(len(config.tokenization.width_bin_boundaries_mm) + 1)
    ]
    positions = [
        f"<POSITION_BIN_{index:02d}>"
        for index in range(len(config.tokenization.position_bin_boundaries_per_mille) + 1)
    ]
    local_references = (
        [f"<ROOM_{index}>" for index in range(config.tokenization.max_local_rooms)]
        + [f"<DOOR_{index}>" for index in range(config.tokenization.max_local_doors)]
        + [f"<OPENING_{index}>" for index in range(config.tokenization.max_local_openings)]
    )
    return (
        control
        + actions
        + observations
        + relatives
        + opening_types
        + durations
        + lengths
        + widths
        + positions
        + local_references
    )
