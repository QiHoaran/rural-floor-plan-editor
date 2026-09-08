"""Exact heading-state cost on a complete rectilinear visibility grid."""

import heapq
from fractions import Fraction as F
from itertools import count

from shapely.geometry import LineString, Point, Polygon

from embodied.config import Config

Position = tuple[F, F]
DIRECTIONS = ((0, 1), (1, 0), (0, -1), (-1, 0))  # N E S W


def distance(a: Position, b: Position) -> F:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def direction(a: Position, b: Position) -> int:
    if a == b or a[0] != b[0] and a[1] != b[1]:
        raise ValueError("PATH_INVALID: movement must be nonzero and rectilinear")
    return (0 if b[1] > a[1] else 2) if a[0] == b[0] else (1 if b[0] > a[0] else 3)


def turns(a: int, b: int) -> int:
    delta = (b - a) % 4
    return min(delta, 4 - delta)


def shift(p: Position, heading: int, length: F) -> Position:
    dx, dy = DIRECTIONS[heading]
    return p[0] + dx * length, p[1] + dy * length


def free_polygon(polygon: tuple[tuple[int, int], ...], config: Config) -> Polygon:
    original = Polygon(polygon)
    if not original.is_valid or original.is_empty:
        raise ValueError("PATH_INVALID: invalid room polygon")
    for a, b in zip(polygon, (*polygon[1:], polygon[0]), strict=True):
        if a == b or a[0] != b[0] and a[1] != b[1]:
            raise ValueError("UNSUPPORTED_GEOMETRY: nonorthogonal boundary")
    free = original.buffer(-config.clearance_mm, join_style="mitre")
    if not isinstance(free, Polygon) or free.is_empty:
        raise ValueError("PATH_INVALID: eroded room is empty or disconnected")
    return free


def collision_free(
    polygon: tuple[tuple[int, int], ...], a: Position, b: Position, config: Config
) -> bool:
    free = free_polygon(polygon, config)
    shape = Point(float(a[0]), float(a[1])) if a == b else LineString([a, b])
    return bool(free.covers(shape))


def plan_path(
    polygon: tuple[tuple[int, int], ...],
    start: Position,
    goal: Position,
    heading: int,
    final_heading: int,
    config: Config,
) -> list[Position]:
    free = free_polygon(polygon, config)
    if not free.covers(Point(float(start[0]), float(start[1]))) or not free.covers(
        Point(float(goal[0]), float(goal[1]))
    ):
        raise ValueError("PATH_INVALID: anchor outside clearance-safe room")
    vertices = [*(free.exterior.coords), *(p for ring in free.interiors for p in ring.coords)]
    # Orthogonal integer input plus integer mitre offset has exact integer vertices.
    if any(F(x).denominator != 1 or F(y).denominator != 1 for x, y in vertices):
        raise ValueError("UNSUPPORTED_GEOMETRY: nonintegral offset vertex; no snapping")
    xs = sorted({F(x) for x, _ in vertices} | {start[0], goal[0]})
    ys = sorted({F(y) for _, y in vertices} | {start[1], goal[1]})
    nodes = [(x, y) for x in xs for y in ys if free.covers(Point(float(x), float(y)))]
    adjacency: dict[Position, list[Position]] = {p: [] for p in nodes}
    for i, a in enumerate(nodes):
        for b in nodes[i + 1 :]:
            if (a[0] == b[0] or a[1] == b[1]) and free.covers(LineString([a, b])):
                adjacency[a].append(b)
                adjacency[b].append(a)
    type Rank = tuple[F, F, int, int, tuple[tuple[int, F, F], ...]]
    counter = count()
    zero: Rank = (F(0), F(0), 0, 0, ())
    queue: list[tuple[Rank, int, Position, int, list[Position]]] = [
        (zero, next(counter), start, heading, [start])
    ]
    best: dict[tuple[Position, int], Rank] = {}
    solutions: list[tuple[Rank, list[Position]]] = []
    while queue:
        rank, _, point, facing, path = heapq.heappop(queue)
        if solutions and rank[0] > min(s[0][0] for s in solutions):
            break
        state = (point, facing)
        if state in best and best[state] <= rank:
            continue
        best[state] = rank
        if point == goal:
            rotation = turns(facing, final_heading)
            final: Rank = (
                rank[0] + config.turn_time(rotation),
                rank[1],
                rank[2] + rotation,
                rank[3] + bool(rotation),
                rank[4],
            )
            solutions.append((final, path))
            continue
        for neighbor in adjacency[point]:
            face = direction(point, neighbor)
            rotation = turns(facing, face)
            length = distance(point, neighbor)
            updated: Rank = (
                rank[0] + config.move_time(length) + config.turn_time(rotation),
                rank[1] + length,
                rank[2] + rotation,
                rank[3] + 1 + bool(rotation),
                (*rank[4], (face, neighbor[0], neighbor[1])),
            )
            heapq.heappush(queue, (updated, next(counter), neighbor, face, [*path, neighbor]))
    if not solutions:
        raise ValueError("PATH_INVALID: no rectilinear path")
    return min(solutions, key=lambda result: result[0])[1]
