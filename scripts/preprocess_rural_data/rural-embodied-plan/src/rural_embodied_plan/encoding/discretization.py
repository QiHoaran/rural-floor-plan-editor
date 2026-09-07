"""Configurable numeric binning for readable geometry tokens."""

from bisect import bisect_left

from rural_embodied_plan.config import BinConfig


def bin_token(prefix: str, value: int, config: BinConfig) -> str:
    """Map an integer value to a stable zero-padded upper-bound bin token."""

    if value < 0:
        raise ValueError(f"Cannot discretize negative {prefix} value: {value}")
    index = bisect_left(config.boundaries, value)
    return f"<{prefix}_BIN_{index:02d}>"
