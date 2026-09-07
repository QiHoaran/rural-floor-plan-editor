from typing import Any

import pytest

from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.v2.behavior_token_decoder import Decoder
from rural_embodied_plan.v2.config import V2Config
from rural_embodied_plan.v2.floorplan import canonicalize_floorplan
from rural_embodied_plan.v2.floorplan_encoder import encode_floorplan


def layout(
    cells: list[tuple[int, int]],
    links: list[tuple[int, int]],
    entries: list[tuple[int, int]],
    *,
    windows: bool = False,
) -> BuildingDocument:
    """Square rooms; edge 0 south / 1 east / 2 north / 3 west."""
    vertices: dict[tuple[int, int], str] = {}
    edges: dict[tuple[tuple[int, int], tuple[int, int]], str] = {}
    faces: dict[str, Any] = {}
    room_edges = []
    for index, (cx, cy) in enumerate(cells):
        points = [
            (cx * 4000, cy * 4000),
            ((cx + 1) * 4000, cy * 4000),
            ((cx + 1) * 4000, (cy + 1) * 4000),
            (cx * 4000, (cy + 1) * 4000),
        ]
        for p in points:
            vertices.setdefault(p, f"v{len(vertices)}")
        keys = []
        for a, b in zip(points, [*points[1:], points[0]], strict=True):
            key = tuple(sorted((a, b)))
            edges.setdefault(key, f"w{len(edges)}")
            keys.append(key)
        room_edges.append(keys)
        faces[f"r{index}"] = {
            "boundary_vertex_ids": [vertices[p] for p in points],
            "area_mm2": 16000000,
            "function_code": f"function_{index}",
        }
    walls = {
        key: {
            "start_vertex_id": vertices[a],
            "end_vertex_id": vertices[b],
            "wall_type": "partition",
            "thickness_mm": 200,
            "height_mm": 2800,
            "material_type": "brick",
        }
        for (a, b), key in edges.items()
    }
    openings: dict[str, Any] = {}
    relations = []

    def add(
        host: str, first: int, second: int | None, offset: int = 1550, window: bool = False
    ) -> None:
        key = f"o{len(openings)}"
        openings[key] = {
            "element_type": "exterior_window"
            if window
            else ("exterior_door" if second is None else "interior_door"),
            "host_wall_id": host,
            "offset_from_start_mm": offset,
            "width_mm": 900,
            "height_mm": 1100 if window else 2100,
            "sill_height_mm": 900 if window else 0,
            "status": "valid",
        }
        relations.append(
            {
                "relation_type": "opening",
                "wall_element_id": key,
                "from_face_id": f"r{first}",
                "to": {"kind": "outside"}
                if second is None
                else {"kind": "face", "face_id": f"r{second}"},
                "channels": {"people": not window, "air": True, "light": True},
            }
        )

    for a, b in links:
        shared = set(room_edges[a]) & set(room_edges[b])
        assert len(shared) == 1
        add(edges[next(iter(shared))], a, b)
    for room, edge in entries:
        add(edges[room_edges[room][edge]], room, None)
    if windows:
        add(edges[room_edges[0][2]], 0, None, 100, True)
        add(edges[room_edges[0][2]], 0, None, 2200, True)
    return BuildingDocument.model_validate(
        {
            "schema_version": "2.1",
            "building_id": "fixture",
            "coordinate_system": {"storage_unit": "mm"},
            "vertices": {key: {"x_mm": p[0], "y_mm": p[1]} for p, key in vertices.items()},
            "walls": walls,
            "faces": faces,
            "wall_elements": openings,
            "relations": relations,
        }
    )


@pytest.mark.parametrize(
    "cells,links,entries,components,loops",
    [
        ([(0, 0)], [], [(0, 0)], 1, 0),
        ([(0, 0), (1, 0)], [(0, 1)], [(0, 0), (1, 0)], 1, 0),
        ([(0, 0), (2, 0)], [], [(0, 0), (1, 0)], 2, 0),
        ([(0, 0)], [], [(0, 0), (0, 2)], 1, 0),
        ([(0, 0), (1, 0), (0, 1)], [(0, 1), (0, 2)], [(0, 0)], 1, 0),
        ([(0, 0), (1, 0), (0, 1), (1, 1)], [(0, 1), (0, 2), (1, 3), (2, 3)], [(0, 0)], 1, 1),
    ],
)
def test_topology_roundtrips(
    cells: list[tuple[int, int]],
    links: list[tuple[int, int]],
    entries: list[tuple[int, int]],
    components: int,
    loops: int,
) -> None:
    f = canonicalize_floorplan(layout(cells, links, entries))
    config = V2Config()
    tokens = encode_floorplan(f, config)
    decoder = Decoder(tokens, config)
    result = decoder.decode()
    assert result == f
    assert encode_floorplan(result, config) == tokens
    assert tokens.count("<EPISODE_BEGIN>") == components
    assert tokens.count("<OBS_LOOP_CLOSURE>") == loops


def test_multiple_windows_and_arbitrary_speed() -> None:
    f = canonicalize_floorplan(layout([(0, 0)], [], [(0, 0)], windows=True))
    config = V2Config(linear_speed_mm_s=1300, crossing_speed_mm_s=1700)
    tokens = encode_floorplan(f, config)
    assert Decoder(tokens, config).decode() == f


def test_unreachable_component_not_dropped() -> None:
    f = canonicalize_floorplan(layout([(0, 0), (2, 0)], [], [(0, 0)]))
    with pytest.raises(ValueError, match="UNREACHABLE_COMPONENT"):
        encode_floorplan(f, V2Config())


def test_decoded_timeline_is_continuous_with_observations() -> None:
    f = canonicalize_floorplan(layout([(0, 0)], [], [(0, 0)]))
    decoder = Decoder(encode_floorplan(f, V2Config()), V2Config())
    decoder.decode()
    assert any(e.get("observation") for e in decoder.events)
    for a, b in zip(decoder.events, decoder.events[1:], strict=False):
        if a["session"] == b["session"]:
            assert a["state_after"] == b["state_before"]
            assert a["end_ms"] == b["start_ms"]


def test_l_shaped_room_roundtrip() -> None:
    from v2_fixtures import raw_rectangle

    raw = raw_rectangle()
    points = [(0, 0), (6000, 0), (6000, 3000), (3000, 3000), (3000, 6000), (0, 6000)]
    raw["vertices"] = {str(i): {"x_mm": x, "y_mm": y} for i, (x, y) in enumerate(points)}
    template = next(iter(raw["walls"].values()))
    raw["walls"] = {
        str(i): dict(template, start_vertex_id=str(i), end_vertex_id=str((i + 1) % len(points)))
        for i in range(len(points))
    }
    raw["faces"]["room"]["boundary_vertex_ids"] = [str(i) for i in range(len(points))]
    f = canonicalize_floorplan(BuildingDocument.model_validate(raw))
    tokens = encode_floorplan(f, V2Config())
    assert Decoder(tokens, V2Config()).decode() == f


def test_source_wall_segmentation_has_canonical_polygon() -> None:
    from v2_fixtures import raw_rectangle

    raw = raw_rectangle()
    raw["vertices"]["mid"] = {"x_mm": 2100, "y_mm": 3200}
    raw["walls"]["extra"] = dict(raw["walls"]["2"], start_vertex_id="mid")
    raw["walls"]["2"]["end_vertex_id"] = "mid"
    f = canonicalize_floorplan(BuildingDocument.model_validate(raw))
    tokens = encode_floorplan(f, V2Config())
    assert Decoder(tokens, V2Config()).decode() == f


def test_no_empty_second_episode() -> None:
    from fractions import Fraction

    from rural_embodied_plan.v2.exact import duration_tokens, uint_tokens

    f = canonicalize_floorplan(layout([(0, 0)], [], [(0, 0)]))
    config = V2Config()
    tokens = encode_floorplan(f, config)
    index = tokens.index("<BUILDING_END>")
    tokens[index:index] = ["<EPISODE_RESET>", "<EPISODE_BEGIN>", "<ENTRY>", "<DOOR>"] + (
        uint_tokens(0)
        + ["<ACT_STOP>"]
        + duration_tokens(Fraction(0), config.duration_bins_ms)
        + ["<EPISODE_END>"]
    )
    with pytest.raises(ValueError, match="TOKEN_GRAMMAR_ERROR"):
        Decoder(tokens, config).decode()


def test_opening_spanning_collinear_room_vertices_roundtrips() -> None:
    from v2_fixtures import raw_rectangle

    raw = raw_rectangle()
    raw["vertices"]["mid"] = {"x_mm": 1500, "y_mm": 200}
    raw["faces"]["room"]["boundary_vertex_ids"] = ["a", "mid", "b", "c", "d"]
    floorplan = canonicalize_floorplan(BuildingDocument.model_validate(raw))
    tokens = encode_floorplan(floorplan, V2Config())
    assert Decoder(tokens, V2Config()).decode() == floorplan
