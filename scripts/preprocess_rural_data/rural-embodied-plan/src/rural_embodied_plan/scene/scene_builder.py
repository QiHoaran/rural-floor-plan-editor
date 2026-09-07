"""End-to-end construction of canonical navigation scenes."""

from rural_embodied_plan.config import ProjectConfig
from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.domain.geometry import Bounds
from rural_embodied_plan.domain.navigation import (
    NavigationScene,
    OpeningType,
    RoomAdjacency,
)
from rural_embodied_plan.scene.opening_builder import build_openings
from rural_embodied_plan.scene.room_builder import build_rooms
from rural_embodied_plan.scene.scene_validator import validate_scene
from rural_embodied_plan.scene.wall_builder import build_wall_segments


def build_scene(document: BuildingDocument, config: ProjectConfig) -> NavigationScene:
    """Convert a validated BuildingDocument into a deterministic scene."""

    rooms = build_rooms(document)
    wall_segments, rooms = build_wall_segments(document, rooms)
    openings, rooms, wall_segments, warnings = build_openings(
        document, rooms, wall_segments, config.anchor_offset_mm
    )
    xs = [vertex.x_mm for vertex in document.vertices.values()]
    ys = [vertex.y_mm for vertex in document.vertices.values()]
    if not xs or not ys:
        raise ValueError("Building contains no vertices")
    adjacency = [
        RoomAdjacency(
            room_a_id=opening.room_ids[0], room_b_id=opening.room_ids[1], opening_id=opening.id
        )
        for opening in openings
        if opening.opening_type in {OpeningType.INTERIOR_DOOR, OpeningType.OPEN_PASSAGE}
    ]
    adjacency.sort(key=lambda item: (item.room_a_id, item.room_b_id, item.opening_id))
    scene = NavigationScene(
        building_id=document.building_id,
        bounds=Bounds(min_x_mm=min(xs), min_y_mm=min(ys), max_x_mm=max(xs), max_y_mm=max(ys)),
        rooms=rooms,
        wall_segments=sorted(wall_segments, key=lambda segment: segment.id),
        openings=openings,
        exterior_doors=sorted(
            opening.id for opening in openings if opening.opening_type == OpeningType.EXTERIOR_DOOR
        ),
        interior_doors=sorted(
            opening.id
            for opening in openings
            if opening.opening_type in {OpeningType.INTERIOR_DOOR, OpeningType.OPEN_PASSAGE}
        ),
        room_adjacency=adjacency,
        warnings=warnings,
    )
    errors = validate_scene(scene)
    if errors:
        raise ValueError("Invalid navigation scene: " + "; ".join(errors))
    return scene
