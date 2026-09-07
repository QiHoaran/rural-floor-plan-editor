"""Room extraction from BuildingDocument faces."""

from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.domain.geometry import Bounds, Point2D
from rural_embodied_plan.domain.navigation import Room
from rural_embodied_plan.geometry.normalization import counter_clockwise, signed_double_area


def build_rooms(document: BuildingDocument) -> list[Room]:
    """Build rooms in sorted source-ID order from explicit face boundaries."""

    rooms: list[Room] = []
    for room_id in sorted(document.faces):
        face = document.faces[room_id]
        try:
            points = [
                Point2D(
                    x_mm=document.vertices[vertex_id].x_mm,
                    y_mm=document.vertices[vertex_id].y_mm,
                )
                for vertex_id in face.boundary_vertex_ids
            ]
        except KeyError as exc:
            raise ValueError(f"Room {room_id} references missing vertex {exc.args[0]}") from exc
        polygon = counter_clockwise(points)
        if any(
            left.x_mm != right.x_mm and left.y_mm != right.y_mm
            for left, right in zip(polygon, polygon[1:] + polygon[:1], strict=True)
        ):
            raise ValueError(f"Room {room_id} has a non-orthogonal boundary edge")
        computed_area = abs(signed_double_area(polygon)) // 2
        if computed_area != face.area_mm2:
            raise ValueError(
                f"Room {room_id} area mismatch: stored={face.area_mm2}, computed={computed_area}"
            )
        xs = [point.x_mm for point in polygon]
        ys = [point.y_mm for point in polygon]
        bounds = Bounds(min_x_mm=min(xs), min_y_mm=min(ys), max_x_mm=max(xs), max_y_mm=max(ys))
        rooms.append(
            Room(
                id=room_id,
                function=face.function_code or "unknown",
                display_name=face.display_name,
                area_mm2=face.area_mm2,
                polygon=polygon,
                bounds=bounds,
                east_west_size_mm=bounds.max_x_mm - bounds.min_x_mm,
                north_south_size_mm=bounds.max_y_mm - bounds.min_y_mm,
                wall_segment_ids=[],
                opening_ids=[],
            )
        )
    return rooms
