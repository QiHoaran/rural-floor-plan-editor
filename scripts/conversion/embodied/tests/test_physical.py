from fractions import Fraction as F

import pytest
from test_regression import layout

from embodied.config import Config
from embodied.floorplan import canonicalize_floorplan


def test_swept_crossing_cannot_use_solid_part_of_host_wall() -> None:
    from embodied.physical import validate_crossing

    floorplan = canonicalize_floorplan(layout([(0, 0)], [], [(0, 0)]))
    opening = floorplan.openings[0]
    validate_crossing(floorplan, opening, (F(2000), F(300)), (F(2000), F(-300)), Config())
    with pytest.raises(ValueError, match="PATH_INVALID"):
        validate_crossing(floorplan, opening, (F(3000), F(300)), (F(3000), F(-300)), Config())
