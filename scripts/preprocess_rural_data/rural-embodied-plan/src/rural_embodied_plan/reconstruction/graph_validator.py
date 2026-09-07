"""Round-trip spatial graph validation."""

from rural_embodied_plan.domain.tokens import SpatialGraph
from rural_embodied_plan.domain.trajectory import Trajectory


def validate_roundtrip(trajectory: Trajectory, graph: SpatialGraph) -> list[str]:
    """Compare the reconstructable graph invariants with the source trajectory."""

    errors: list[str] = []
    if len(graph.rooms) != len(trajectory.room_activations):
        errors.append("Room count differs after token round-trip")
    expected_ids = [activation.dynamic_id for activation in trajectory.room_activations]
    if [room.dynamic_id for room in graph.rooms] != expected_ids:
        errors.append("Dynamic room IDs differ after token round-trip")
    expected_functions = [activation.function for activation in trajectory.room_activations]
    if [room.function for room in graph.rooms] != expected_functions:
        errors.append("Room functions differ after token round-trip")
    if graph.loop_count != trajectory.loop_closure_count:
        errors.append("Loop count differs after token round-trip")
    if graph.primary_exterior_door_id != trajectory.primary_exterior_door_id:
        errors.append("Primary exterior door differs after token round-trip")
    return errors
