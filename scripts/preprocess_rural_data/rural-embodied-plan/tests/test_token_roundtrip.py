"""Action-observation token round-trip tests."""

from rural_embodied_plan.config import ProjectConfig
from rural_embodied_plan.domain.trajectory import Trajectory
from rural_embodied_plan.encoding.trajectory_encoder import encode_trajectory
from rural_embodied_plan.reconstruction.graph_builder import reconstruct_spatial_graph
from rural_embodied_plan.reconstruction.graph_validator import validate_roundtrip


def test_tokens_reconstruct_principal_spatial_graph(
    trajectory: Trajectory, config: ProjectConfig
) -> None:
    """Tokens alone recover rooms, semantics, door graph, entry, depth, and directions."""

    tokens = encode_trajectory(trajectory, config)
    graph = reconstruct_spatial_graph(tokens)
    assert validate_roundtrip(trajectory, graph) == []
    assert len(graph.rooms) == 5
    assert len([edge for edge in graph.edges if not edge.exterior]) == 3
    assert len([edge for edge in graph.edges if edge.exterior]) == 2
    assert graph.entrance_room_id == "ROOM_0"
    assert graph.opening_directions["we_0003"] == ["SOUTH"]
