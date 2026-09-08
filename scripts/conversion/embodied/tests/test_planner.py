from fractions import Fraction as F

import pytest


def test_terminal_heading_included_and_path_unique() -> None:
    from embodied.config import Config
    from embodied.planner import plan_path

    polygon = ((0, 0), (5000, 0), (5000, 4000), (0, 4000))
    path = plan_path(polygon, (F(1000), F(1000)), (F(3000), F(3000)), 1, 0, Config())
    assert path == [(1000, 1000), (3000, 1000), (3000, 3000)]


def test_nonconvex_path_and_impossible_anchor() -> None:
    from embodied.config import Config
    from embodied.planner import plan_path

    polygon = (
        (0, 0),
        (6000, 0),
        (6000, 6000),
        (4000, 6000),
        (4000, 2000),
        (2000, 2000),
        (2000, 6000),
        (0, 6000),
    )
    path = plan_path(polygon, (F(1000), F(5000)), (F(5000), F(5000)), 2, 0, Config())
    assert min(p[1] for p in path) <= 1750
    with pytest.raises(ValueError, match="PATH_INVALID"):
        plan_path(polygon, (F(0), F(0)), (F(5000), F(5000)), 2, 0, Config())
