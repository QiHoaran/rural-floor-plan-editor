"""Polygon winding and stable normalization."""

from rural_embodied_plan.domain.geometry import Point2D


def signed_double_area(points: list[Point2D]) -> int:
    """Return signed double polygon area using integer arithmetic."""

    return sum(
        point.x_mm * points[(index + 1) % len(points)].y_mm
        - points[(index + 1) % len(points)].x_mm * point.y_mm
        for index, point in enumerate(points)
    )


def counter_clockwise(points: list[Point2D]) -> list[Point2D]:
    """Return a CCW copy with a canonical first vertex."""

    area = signed_double_area(points)
    if area == 0:
        raise ValueError("Room polygon has zero area")
    oriented = list(points if area > 0 else reversed(points))
    first = min(
        range(len(oriented)),
        key=lambda index: (
            oriented[index].x_mm,
            oriented[index].y_mm,
            oriented[(index + 1) % len(oriented)].x_mm,
            oriented[(index + 1) % len(oriented)].y_mm,
        ),
    )
    return oriented[first:] + oriented[:first]
