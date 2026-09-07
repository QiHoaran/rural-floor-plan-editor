"""Public spatial-graph reconstruction entry point."""

from rural_embodied_plan.domain.tokens import SpatialGraph, TokenSequence
from rural_embodied_plan.encoding.trajectory_decoder import decode_tokens


def reconstruct_spatial_graph(tokens: TokenSequence) -> SpatialGraph:
    """Reconstruct the spatial graph from tokens only."""

    return decode_tokens(tokens)
