"""Exact integer action timing and versioned duration discretization."""

from bisect import bisect_left


def _ceil_div(numerator: int, denominator: int) -> int:
    if numerator < 0:
        raise ValueError("Duration inputs must be non-negative")
    if denominator <= 0:
        raise ValueError("Speed must be positive")
    return (numerator + denominator - 1) // denominator


def movement_duration_ms(distance_mm: int, speed_mm_per_s: int) -> int:
    """Convert integer millimetres to integer milliseconds using ceiling division."""

    return _ceil_div(distance_mm * 1000, speed_mm_per_s)


def turn_duration_ms(angle_mdeg: int, speed_mdeg_per_s: int) -> int:
    """Convert integer milli-degrees to integer milliseconds using ceiling division."""

    return _ceil_div(angle_mdeg * 1000, speed_mdeg_per_s)


def duration_bin_token(duration_ms: int, boundaries_ms: list[int]) -> str:
    """Encode zero exactly and positive durations by inclusive upper-bound bins."""

    if duration_ms < 0:
        raise ValueError("Duration must be non-negative")
    if not boundaries_ms or boundaries_ms[0] != 0:
        raise ValueError("Duration boundaries must begin with zero")
    if boundaries_ms != sorted(set(boundaries_ms)):
        raise ValueError("Duration boundaries must be strictly increasing")
    if duration_ms == 0:
        return "<DT_00>"
    index = bisect_left(boundaries_ms, duration_ms)
    if index == len(boundaries_ms):
        return "<DT_OVERFLOW>"
    return f"<DT_{index:02d}>"
