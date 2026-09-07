from copy import deepcopy

import pytest
from v2_fixtures import raw_rectangle

from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.v2.floorplan import canonicalize_floorplan


def canonical(raw=None):
    return canonicalize_floorplan(BuildingDocument.model_validate(raw or raw_rectangle()))


def test_normalizes_losslessly_and_is_idempotent():
    floor = canonical()
    assert (floor.width_mm, floor.height_mm) == (4000, 3000)
    assert floor.rooms[0].polygon == ((0, 0), (4000, 0), (4000, 3000), (0, 3000))
    assert floor.rooms[0].function is None
    assert floor.openings[0].width_mm == 901
    assert floor.openings[0].offset_mm == 1000
    assert floor.openings[0].channels == {"people": True, "air": True, "light": True}
    assert canonicalize_floorplan(floor) == floor


def test_ids_order_orientation_and_orphan_vertices_do_not_matter():
    raw = raw_rectangle()
    raw["vertices"]["unused"] = {"x_mm": -99999, "y_mm": 99999}
    raw["faces"]["room"]["boundary_vertex_ids"].reverse()
    wall = raw["walls"]["0"]
    wall["start_vertex_id"], wall["end_vertex_id"] = wall["end_vertex_id"], wall["start_vertex_id"]
    raw["wall_elements"]["door"]["offset_from_start_mm"] = 4000 - 1000 - 901
    raw["walls"] = {"renamed" + k: v for k, v in reversed(list(raw["walls"].items()))}
    raw["wall_elements"]["door"]["host_wall_id"] = "renamed0"
    assert canonical(raw) == canonical()


@pytest.mark.parametrize(
    "kind,code",
    [
        ("uncovered", "UNOBSERVABLE_GEOMETRY"),
        ("duplicate", "AMBIGUOUS_GEOMETRY"),
        ("diagonal", "UNSUPPORTED_GEOMETRY"),
        ("relation", "INCONSISTENT_INCIDENCE"),
        ("unobserved", "UNOBSERVED_OPENING"),
    ],
)
def test_rejects_invalid_sources(kind, code):
    raw = raw_rectangle()
    if kind == "uncovered":
        raw["vertices"]["x"] = {"x_mm": 5000, "y_mm": 200}
        raw["walls"]["extra"] = dict(raw["walls"]["0"], start_vertex_id="b", end_vertex_id="x")
    elif kind == "duplicate":
        raw["walls"]["extra"] = deepcopy(raw["walls"]["0"])
    elif kind == "diagonal":
        raw["vertices"]["a"]["x_mm"] += 1
    elif kind == "relation":
        raw["relations"][0]["from_face_id"] = "missing"
    else:
        raw["relations"] = []
    with pytest.raises(ValueError, match=code):
        canonical(raw)


def test_models_are_frozen_and_strict():
    floor = canonical()
    with pytest.raises(ValueError):
        floor.width_mm = 8
    with pytest.raises(ValueError):
        type(floor.walls[0]).model_validate(dict(floor.walls[0].model_dump(), thickness_mm="12"))


def test_channels_cannot_be_mutated():
    floor = canonical()
    with pytest.raises(TypeError):
        floor.openings[0].channels["people"] = False


def test_explicit_obstacles_are_not_silently_discarded():
    raw = raw_rectangle()
    raw["obstacles"] = [{"polygon": [[500, 500], [600, 500], [600, 600], [500, 600]]}]
    with pytest.raises(ValueError, match="UNSUPPORTED_GEOMETRY"):
        canonical(raw)


def test_opening_crosses_collinear_room_vertex_without_loss():
    raw = raw_rectangle()
    raw["vertices"]["middle"] = {"x_mm": 1600, "y_mm": 200}
    raw["faces"]["room"]["boundary_vertex_ids"].insert(1, "middle")
    floor = canonical(raw)
    assert floor.openings[0].width_mm == 901


def test_conflicting_channels_rejected():
    raw = raw_rectangle()
    raw["relations"].append(dict(raw["relations"][0], channels={"people": False}))
    with pytest.raises(ValueError, match="INCONSISTENT_CHANNELS"):
        canonical(raw)


def test_canonical_boundary_is_validated():
    floor = canonical()
    malformed = floor.model_copy(
        update={"rooms": (floor.rooms[0].model_copy(update={"boundary": ()}),)}
    )
    with pytest.raises(ValueError, match="INCONSISTENT_INCIDENCE"):
        canonicalize_floorplan(malformed)


def test_overlapping_rooms_rejected():
    raw = raw_rectangle()
    raw["faces"]["copy"] = deepcopy(raw["faces"]["room"])
    with pytest.raises(ValueError, match="AMBIGUOUS_GEOMETRY"):
        canonical(raw)


def test_crossing_room_interiors_rejected():
    raw = raw_rectangle()
    other = raw_rectangle()
    raw["wall_elements"] = {}
    raw["relations"] = []
    for key, point in other["vertices"].items():
        raw["vertices"]["x" + key] = {"x_mm": point["x_mm"] + 1000, "y_mm": point["y_mm"] + 1000}
    for key, wall in other["walls"].items():
        raw["walls"]["x" + key] = dict(
            wall,
            start_vertex_id="x" + wall["start_vertex_id"],
            end_vertex_id="x" + wall["end_vertex_id"],
        )
    raw["faces"]["other"] = dict(
        other["faces"]["room"], boundary_vertex_ids=["xa", "xb", "xc", "xd"]
    )
    with pytest.raises(ValueError, match="AMBIGUOUS_GEOMETRY"):
        canonical(raw)


def test_two_adjacent_rooms_share_wall_and_internal_opening():
    raw = raw_rectangle()
    raw["vertices"].update({"e": {"x_mm": 8100, "y_mm": 200}, "f": {"x_mm": 8100, "y_mm": 3200}})
    raw["walls"]["1"]["wall_type"] = "interior"
    for key, a, b in [("4", "b", "e"), ("5", "e", "f"), ("6", "f", "c")]:
        raw["walls"][key] = dict(raw["walls"]["0"], start_vertex_id=a, end_vertex_id=b)
    raw["faces"]["other"] = dict(
        raw["faces"]["room"], boundary_vertex_ids=["b", "e", "f", "c"], function_code="bedroom"
    )
    raw["wall_elements"]["inside"] = dict(
        raw["wall_elements"]["door"], element_type="interior_door", host_wall_id="1"
    )
    raw["relations"].append(
        dict(raw["relations"][0], wall_element_id="inside", to={"kind": "face", "face_id": "other"})
    )
    floor = canonical(raw)
    opening = next(o for o in floor.openings if o.opening_type == "interior_door")
    assert opening.room_ids == ("R0", "R1")
    assert not opening.connects_outside
    assert canonicalize_floorplan(floor) == floor
