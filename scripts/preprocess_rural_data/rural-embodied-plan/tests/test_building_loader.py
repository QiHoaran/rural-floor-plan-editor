"""BuildingDocument loading tests."""

from rural_embodied_plan.domain.building import BuildingDocument


def test_sample_fields_are_loaded_without_guessing(building: BuildingDocument) -> None:
    """The loader preserves the verified source collections and units."""

    assert building.schema_version == "2.1.0"
    assert building.coordinate_system["storage_unit"] == "mm"
    assert len(building.faces) == 5
    assert len(building.walls) == 16
    assert len(building.wall_elements) == 10
    assert {face.function_code for face in building.faces.values()} == {"bedroom", "living_room"}
