"""Conservative square-footprint swept checks in nominal 2D wall geometry."""

from fractions import Fraction as F

from shapely.geometry import LineString

from rural_embodied_plan.v2.config import V2Config
from rural_embodied_plan.v2.floorplan import CanonicalFloorplan, Opening
from rural_embodied_plan.v2.planner import Position, direction, shift


def validate_crossing(
    floorplan: CanonicalFloorplan,
    opening: Opening,
    start: Position,
    end: Position,
    config: V2Config,
) -> None:
    direction(start, end)  # nonzero rectilinear, no diagonal/teleport
    swept = LineString([start, end]).buffer(
        config.clearance_mm, cap_style="square", join_style="mitre"
    )
    for wall in floorplan.walls:
        a = (F(wall.start[0]), F(wall.start[1]))
        b = (F(wall.end[0]), F(wall.end[1]))
        segments = [(a, b)]
        if wall.id == opening.host_wall_id:
            axis = direction(a, b)
            lo = shift(a, axis, F(opening.offset_mm))
            hi = shift(a, axis, F(opening.offset_mm + opening.width_mm))
            segments = [(a, lo), (hi, b)]
        for left, right in segments:
            if left != right and swept.relate_pattern(LineString([left, right]), "T********"):
                raise ValueError("PATH_INVALID: crossing footprint intersects solid wall")
