"""Cardinal direction arithmetic."""

from rural_embodied_plan.domain.geometry import Direction, Point2D, RelativeDirection

_ORDER = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST]


def turn(heading: Direction, relative: RelativeDirection) -> Direction:
    """Resolve a relative direction against a global heading."""

    offsets = {
        RelativeDirection.FRONT: 0,
        RelativeDirection.RIGHT: 1,
        RelativeDirection.BACK: 2,
        RelativeDirection.LEFT: -1,
    }
    return _ORDER[(_ORDER.index(heading) + offsets[relative]) % 4]


def relative_direction(heading: Direction, target: Direction) -> RelativeDirection:
    """Return the relative turn from heading to target."""

    delta = (_ORDER.index(target) - _ORDER.index(heading)) % 4
    return [
        RelativeDirection.FRONT,
        RelativeDirection.RIGHT,
        RelativeDirection.BACK,
        RelativeDirection.LEFT,
    ][delta]


def opposite(direction: Direction) -> Direction:
    """Return the opposite cardinal direction."""

    return _ORDER[(_ORDER.index(direction) + 2) % 4]


def direction_between(start: Point2D, end: Point2D) -> Direction:
    """Return the direction of a non-zero orthogonal displacement."""

    if start.x_mm == end.x_mm:
        if end.y_mm > start.y_mm:
            return Direction.NORTH
        if end.y_mm < start.y_mm:
            return Direction.SOUTH
    if start.y_mm == end.y_mm:
        if end.x_mm > start.x_mm:
            return Direction.EAST
        if end.x_mm < start.x_mm:
            return Direction.WEST
    raise ValueError(f"Points do not define a non-zero orthogonal move: {start} -> {end}")


def vector(direction: Direction) -> tuple[int, int]:
    """Return the integer unit vector for a cardinal direction."""

    return {
        Direction.NORTH: (0, 1),
        Direction.EAST: (1, 0),
        Direction.SOUTH: (0, -1),
        Direction.WEST: (-1, 0),
    }[direction]
