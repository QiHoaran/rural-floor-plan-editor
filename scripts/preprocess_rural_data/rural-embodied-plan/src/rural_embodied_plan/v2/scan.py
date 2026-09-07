"""Synthetic clockwise exterior projection scan; no visibility assumptions."""

from dataclasses import dataclass
from fractions import Fraction as F

from rural_embodied_plan.v2.planner import Position, distance


@dataclass(frozen=True)
class ScanDoor:
    id: str
    center: Position
    normal: int
    width_mm: int
    structural_key: str = ""


@dataclass(frozen=True)
class Projection:
    door: ScanDoor
    point: Position
    depth: F
    arclength: F


@dataclass(frozen=True)
class ScanGeometry:
    points: tuple[Position, ...]
    doors: tuple[Projection, ...]
    offset: int

    @property
    def start(self) -> Position:
        return self.points[0]

    @property
    def leg_lengths(self) -> tuple[F, ...]:
        return tuple(distance(a, b) for a, b in zip(self.points, self.points[1:], strict=False))

    def recover_bbox(self) -> tuple[F, F]:
        a, b, c, d, e = self.leg_lengths
        if a != e or b != d or 2 * a != c:
            raise ValueError("PATH_INVALID: scan is not canonical closed rectangle")
        return c - 2 * self.offset, b - 2 * self.offset


def scan_geometry(width: int, height: int, offset: int, doors: list[ScanDoor]) -> ScanGeometry:
    if min(width, height, offset) <= 0:
        raise ValueError("PATH_INVALID: nonpositive scan dimensions")
    w, h, o = F(width), F(height), F(offset)
    points: tuple[Position, ...] = (
        (w / 2, -o),
        (-o, -o),
        (-o, h + o),
        (w + o, h + o),
        (w + o, -o),
        (w / 2, -o),
    )
    a, b, c = w / 2 + o, h + 2 * o, w + 2 * o
    perimeter = 2 * (b + c)
    projections = []
    for door in doors:
        x, y = door.center
        if not (0 <= x <= w and 0 <= y <= h):
            raise ValueError("GEOMETRY_CONFLICT: door outside bbox")
        if door.normal == 2:
            point = (x, -o)
            depth = y + o
            s = (w / 2 - x) % perimeter
        elif door.normal == 3:
            point = (-o, y)
            depth = x + o
            s = a + y + o
        elif door.normal == 0:
            point = (x, h + o)
            depth = h + o - y
            s = a + b + x + o
        elif door.normal == 1:
            point = (w + o, y)
            depth = w + o - x
            s = a + b + c + h + o - y
        else:
            raise ValueError("GEOMETRY_CONFLICT: noncardinal exterior normal")
        projections.append(Projection(door, point, depth, s))

    def key(p: Projection) -> tuple[object, ...]:
        return (
            p.arclength,
            p.door.normal,
            p.depth,
            p.door.center,
            p.door.width_mm,
            p.door.structural_key,
        )

    projections.sort(key=key)
    if any(key(a) == key(b) for a, b in zip(projections, projections[1:], strict=False)):
        raise ValueError("AMBIGUOUS_CANONICAL_ENTITY: duplicate scan projection")
    return ScanGeometry(points, tuple(projections), offset)
