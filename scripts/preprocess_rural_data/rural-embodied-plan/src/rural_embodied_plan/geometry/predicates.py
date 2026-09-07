"""Exact predicates for orthogonal building geometry."""

from shapely import Polygon
from shapely.geometry import LineString, Point

from rural_embodied_plan.domain.geometry import LineSegment, Point2D


def segment_covers(outer: LineSegment, inner: LineSegment) -> bool:
    """Return whether one collinear segment fully covers another."""

    if outer.start.x_mm == outer.end.x_mm == inner.start.x_mm == inner.end.x_mm:
        outer_range = sorted((outer.start.y_mm, outer.end.y_mm))
        inner_range = sorted((inner.start.y_mm, inner.end.y_mm))
    elif outer.start.y_mm == outer.end.y_mm == inner.start.y_mm == inner.end.y_mm:
        outer_range = sorted((outer.start.x_mm, outer.end.x_mm))
        inner_range = sorted((inner.start.x_mm, inner.end.x_mm))
    else:
        return False
    return outer_range[0] <= inner_range[0] and inner_range[1] <= outer_range[1]


def path_inside_polygon(path: list[Point2D], polygon: list[Point2D]) -> bool:
    """Return whether every path segment is covered by the closed room polygon."""

    if not path:
        return False
    shape = Polygon([(point.x_mm, point.y_mm) for point in polygon])
    if not shape.is_valid:
        raise ValueError("Cannot test path against an invalid room polygon")
    if len(path) == 1:
        return bool(shape.covers(Point(path[0].x_mm, path[0].y_mm)))
    line = LineString([(point.x_mm, point.y_mm) for point in path])
    return bool(shape.covers(line))
