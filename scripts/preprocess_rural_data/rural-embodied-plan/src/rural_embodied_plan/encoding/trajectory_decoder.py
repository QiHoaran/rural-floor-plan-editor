"""Token metadata decoding into a reconstructed spatial graph."""

from urllib.parse import unquote

from rural_embodied_plan.domain.tokens import (
    SpatialGraph,
    SpatialGraphEdge,
    SpatialGraphRoom,
    TokenSequence,
)


def _extract(token: str, prefix: str) -> str:
    marker = f"<{prefix}_"
    if not token.startswith(marker) or not token.endswith(">"):
        raise ValueError(f"Expected {prefix} value token, got {token}")
    return unquote(token[len(marker) : -1])


def decode_tokens(sequence: TokenSequence) -> SpatialGraph:
    """Reconstruct graph content solely from the readable token sequence."""

    tokens = sequence.tokens
    if not tokens or tokens[0] != "<BOS>" or tokens[-1] != "<EOS>":
        raise ValueError("Token sequence must be enclosed by BOS/EOS")
    primary = ""
    loop_count = 0
    rooms: list[SpatialGraphRoom] = []
    edges: list[SpatialGraphEdge] = []
    directions: dict[str, list[str]] = {}
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.startswith("<PRIMARY_EXTERIOR_DOOR_"):
            primary = _extract(token, "PRIMARY_EXTERIOR_DOOR")
        elif token.startswith("<LOOP_COUNT_"):
            loop_count = int(_extract(token, "LOOP_COUNT"))
        elif token == "<ROOM_BEGIN>":
            block = tokens[index + 1 : tokens.index("<ROOM_END>", index + 1)]
            dynamic = block[0][1:-1].replace("ROOM_NEW_", "ROOM_")
            function = _extract(
                next(value for value in block if value.startswith("<FUNCTION_")), "FUNCTION"
            )
            depth = int(
                _extract(next(value for value in block if value.startswith("<DEPTH_")), "DEPTH")
            )
            area_bin = next(value for value in block if value.startswith("<AREA_BIN_"))
            rooms.append(
                SpatialGraphRoom(
                    dynamic_id=dynamic, function=function, depth=depth, area_bin=area_bin
                )
            )
        elif token == "<EDGE_BEGIN>":
            end = tokens.index("<EDGE_END>", index + 1)
            block = tokens[index + 1 : end]
            door_id = _extract(next(value for value in block if value.startswith("<DOOR_")), "DOOR")
            room_a = _extract(next(value for value in block if value.startswith("<FROM_")), "FROM")
            room_b_value = _extract(
                next(value for value in block if value.startswith("<TO_")), "TO"
            )
            exterior = "<EXTERIOR_TRUE>" in block
            edges.append(
                SpatialGraphEdge(
                    door_id=door_id,
                    room_a=room_a,
                    room_b=None if room_b_value == "OUTSIDE" else room_b_value,
                    exterior=exterior,
                )
            )
            index = end
        elif token == "<OPENING_DIRECTION_BEGIN>":
            end = tokens.index("<OPENING_DIRECTION_END>", index + 1)
            block = tokens[index + 1 : end]
            opening_id = _extract(
                next(value for value in block if value.startswith("<OPENING_")), "OPENING"
            )
            direction = next(value for value in block if value.startswith("<DIR_"))[5:-1]
            directions.setdefault(opening_id, []).append(direction)
            index = end
        index += 1
    if not primary:
        raise ValueError("Token sequence has no primary exterior door")
    for edge in edges:
        edge.directions = sorted(directions.get(edge.door_id, []))
    entrance_edges = [edge for edge in edges if edge.door_id == primary and edge.exterior]
    if len(entrance_edges) != 1:
        raise ValueError("Primary exterior door must identify exactly one entrance room")
    return SpatialGraph(
        vocabulary_version=sequence.vocabulary_version,
        rooms=rooms,
        edges=edges,
        primary_exterior_door_id=primary,
        entrance_room_id=entrance_edges[0].room_a,
        loop_count=loop_count,
        opening_directions={key: sorted(values) for key, values in sorted(directions.items())},
    )
