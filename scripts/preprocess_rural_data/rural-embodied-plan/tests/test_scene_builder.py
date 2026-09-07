"""Scene construction and semantic integrity tests."""

from rural_embodied_plan.domain.navigation import NavigationScene, OpeningType
from rural_embodied_plan.scene.scene_validator import validate_scene


def test_sample_scene_counts_and_integrity(scene: NavigationScene) -> None:
    """The sample becomes a complete, valid canonical scene."""

    assert len(scene.rooms) == 5
    assert len(scene.wall_segments) == 20
    assert len(scene.openings) == 10
    assert len(scene.exterior_doors) == 2
    assert len(scene.interior_doors) == 3
    assert validate_scene(scene) == []
    assert all(
        opening.connects_outside
        for opening in scene.openings
        if opening.opening_type == OpeningType.EXTERIOR_DOOR
    )
