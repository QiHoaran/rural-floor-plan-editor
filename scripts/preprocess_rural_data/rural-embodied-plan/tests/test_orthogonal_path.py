"""Orthogonal path legality and fallback tests."""

from rural_embodied_plan.domain.geometry import Direction, Point2D
from rural_embodied_plan.geometry.orthogonal_path import orthogonal_path
from rural_embodied_plan.geometry.predicates import path_inside_polygon


def test_concave_polygon_uses_visibility_fallback() -> None:
    """A U-shaped room routes around its orthogonal indentation."""

    polygon = [
        Point2D(x_mm=0, y_mm=0),
        Point2D(x_mm=6000, y_mm=0),
        Point2D(x_mm=6000, y_mm=6000),
        Point2D(x_mm=4000, y_mm=6000),
        Point2D(x_mm=4000, y_mm=2000),
        Point2D(x_mm=2000, y_mm=2000),
        Point2D(x_mm=2000, y_mm=6000),
        Point2D(x_mm=0, y_mm=6000),
    ]
    start = Point2D(x_mm=1000, y_mm=5000)
    goal = Point2D(x_mm=5000, y_mm=5000)
    path = orthogonal_path(start, goal, polygon, Direction.SOUTH)
    assert path_inside_polygon(path, polygon)
    assert len(path) >= 4
    assert all(
        left.x_mm == right.x_mm or left.y_mm == right.y_mm
        for left, right in zip(path, path[1:], strict=False)
    )
    assert list(reversed(list(reversed(path)))) == path
