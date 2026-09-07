"""Byte-level determinism and translation-invariance tests."""

from rural_embodied_plan.config import ProjectConfig
from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.domain.geometry import Point2D
from rural_embodied_plan.encoding.trajectory_encoder import encode_trajectory
from rural_embodied_plan.geometry.normalization import counter_clockwise
from rural_embodied_plan.scene.scene_builder import build_scene
from rural_embodied_plan.traversal.explorer import generate_trajectory


def test_repeated_core_models_are_identical(
    building: BuildingDocument, config: ProjectConfig
) -> None:
    """Two independent runs serialize to exactly the same core data."""

    scene_a = build_scene(building, config)
    scene_b = build_scene(building, config)
    trajectory_a = generate_trajectory(scene_a)
    trajectory_b = generate_trajectory(scene_b)
    tokens_a = encode_trajectory(trajectory_a, config)
    tokens_b = encode_trajectory(trajectory_b, config)
    assert scene_a.model_dump_json() == scene_b.model_dump_json()
    assert trajectory_a.model_dump_json() == trajectory_b.model_dump_json()
    assert tokens_a.model_dump_json() == tokens_b.model_dump_json()


def test_translation_invariance(building: BuildingDocument, config: ProjectConfig) -> None:
    """Translation changes absolute coordinates but not graph, actions, directions, or distances."""

    shifted = building.model_copy(deep=True)
    for vertex in shifted.vertices.values():
        vertex.x_mm += 12345
        vertex.y_mm -= 6789
    scene_a = build_scene(building, config)
    scene_b = build_scene(shifted, config)
    trajectory_a = generate_trajectory(scene_a)
    trajectory_b = generate_trajectory(scene_b)
    assert scene_a.room_adjacency == scene_b.room_adjacency
    actions_a = [event.action.type if event.action else None for event in trajectory_a.events]
    actions_b = [event.action.type if event.action else None for event in trajectory_b.events]
    assert actions_a == actions_b
    distances_a = [event.action.distance_mm for event in trajectory_a.events if event.action]
    distances_b = [event.action.distance_mm for event in trajectory_b.events if event.action]
    assert distances_a == distances_b
    directions_a = [
        event.observation.global_direction for event in trajectory_a.events if event.observation
    ]
    directions_b = [
        event.observation.global_direction for event in trajectory_b.events if event.observation
    ]
    assert directions_a == directions_b


def test_polygon_normalization_is_invariant_to_cyclic_start_vertex() -> None:
    points = [
        Point2D(x_mm=0, y_mm=0),
        Point2D(x_mm=4000, y_mm=0),
        Point2D(x_mm=4000, y_mm=3000),
        Point2D(x_mm=0, y_mm=3000),
    ]

    expected = counter_clockwise(points)
    assert counter_clockwise(points[1:] + points[:1]) == expected
    assert counter_clockwise(list(reversed(points[2:] + points[:2]))) == expected
