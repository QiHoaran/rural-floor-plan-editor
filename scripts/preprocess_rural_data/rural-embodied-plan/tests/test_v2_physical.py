from fractions import Fraction as F

import pytest
from test_v2_regression import layout

from rural_embodied_plan.v2.config import V2Config
from rural_embodied_plan.v2.floorplan import canonicalize_floorplan


def test_swept_crossing_cannot_use_solid_part_of_host_wall() -> None:
    from rural_embodied_plan.v2.physical import validate_crossing

    floorplan = canonicalize_floorplan(layout([(0, 0)], [], [(0, 0)]))
    opening = floorplan.openings[0]
    validate_crossing(floorplan, opening, (F(2000), F(300)), (F(2000), F(-300)), V2Config())
    with pytest.raises(ValueError, match="PATH_INVALID"):
        validate_crossing(floorplan, opening, (F(3000), F(300)), (F(3000), F(-300)), V2Config())
