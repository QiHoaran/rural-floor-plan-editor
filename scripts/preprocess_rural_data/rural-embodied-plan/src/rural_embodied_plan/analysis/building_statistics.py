"""Stable summaries of source and navigation-scene buildings."""

from typing import Any

from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.domain.navigation import NavigationScene, OpeningType


def building_summary(document: BuildingDocument, scene: NavigationScene) -> dict[str, Any]:
    """Return deterministic counts and source-format metadata."""

    return {
        "building_id": document.building_id,
        "source_schema_version": document.schema_version,
        "coordinate_system": document.coordinate_system,
        "vertex_count": len(document.vertices),
        "source_wall_count": len(document.walls),
        "room_boundary_wall_segment_count": len(scene.wall_segments),
        "room_count": len(scene.rooms),
        "opening_count": len(scene.openings),
        "exterior_door_count": sum(
            opening.opening_type == OpeningType.EXTERIOR_DOOR for opening in scene.openings
        ),
        "interior_door_count": sum(
            opening.opening_type in {OpeningType.INTERIOR_DOOR, OpeningType.OPEN_PASSAGE}
            for opening in scene.openings
        ),
        "window_count": sum(
            opening.opening_type == OpeningType.WINDOW for opening in scene.openings
        ),
        "warnings": scene.warnings,
    }


def inspect_building(document: BuildingDocument) -> dict[str, Any]:
    """Expose source collection fields without guessing their semantics."""

    def fields(values: list[Any]) -> list[str]:
        result: set[str] = set()
        for value in values:
            if hasattr(value, "model_fields_set"):
                result.update(value.model_fields_set)
        return sorted(result)

    return {
        "building_id": document.building_id,
        "schema_version": document.schema_version,
        "top_level_fields": sorted(document.model_fields_set),
        "coordinate_system": document.coordinate_system,
        "collections": {
            "vertices": {
                "count": len(document.vertices),
                "fields": fields(list(document.vertices.values())),
            },
            "walls": {
                "count": len(document.walls),
                "fields": fields(list(document.walls.values())),
            },
            "wall_elements": {
                "count": len(document.wall_elements),
                "fields": fields(list(document.wall_elements.values())),
            },
            "faces": {
                "count": len(document.faces),
                "fields": fields(list(document.faces.values())),
            },
            "relations": {
                "count": len(document.relations),
                "fields": fields(list(document.relations)),
            },
            "outside_regions": {"count": len(document.outside_regions)},
        },
    }
