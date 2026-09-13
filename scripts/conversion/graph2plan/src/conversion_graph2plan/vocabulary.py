"""Official Graph2Plan / RPLAN label tables plus the explicit rural mapping.

Every table here is transcribed from the upstream sources rather than from the
README prose:

* ``ROOM_LABEL`` / ``PREDICATES`` -> ``Network/model/utils.py`` ``get_vocab()``
* ``EDGE_TYPES``                  -> ``DataPreparation/README.md``, order verified
                                     against ``Network/model/utils.py``
* ``LABEL_RGB``                   -> ``Network/model/utils.py`` ``get_color_map()``

The model's room vocabulary is ``0..12``: ``Network/train.py`` builds a 15-way
CrossEntropy weight and then zeroes entries 13 and 14, and
``DataPreparation/3.rNum_train.py`` only counts ``range(13)``. Classes 13
(External) and 14 (ExteriorWall) exist only as layout-image pixels, never as a
room label, so every mapped value must stay within ``0..12``.
"""

from __future__ import annotations

# (index, name, is_public, texture) -- RPLAN room_label, indices are the rType values.
ROOM_LABEL: tuple[tuple[int, str, int, str], ...] = (
    (0, "LivingRoom", 1, "PublicArea"),
    (1, "MasterRoom", 0, "Bedroom"),
    (2, "Kitchen", 1, "FunctionArea"),
    (3, "Bathroom", 0, "FunctionArea"),
    (4, "DiningRoom", 1, "FunctionArea"),
    (5, "ChildRoom", 0, "Bedroom"),
    (6, "StudyRoom", 0, "Bedroom"),
    (7, "SecondRoom", 0, "Bedroom"),
    (8, "GuestRoom", 0, "Bedroom"),
    (9, "Balcony", 1, "PublicArea"),
    (10, "Entrance", 1, "PublicArea"),
    (11, "Storage", 0, "PublicArea"),
    (12, "Wall-in", 0, "PublicArea"),
    (13, "External", 0, "External"),
    (14, "ExteriorWall", 0, "ExteriorWall"),
    (15, "FrontDoor", 0, "FrontDoor"),
    (16, "InteriorWall", 0, "InteriorWall"),
    (17, "InteriorDoor", 0, "InteriorDoor"),
)

# Layout-image pixel classes used by FloorPlan.get_layout_image.
ROOM_LABEL_MAX = 12
OUTSIDE_LABEL = 13
EXTERIOR_WALL_LABEL = 14

# Relative-position predicates. Index order is load-bearing: FloorPlan.get_triples
# looks the predicate up in this exact list, and DataPreparation/4.data_train_eNum.py
# applies a fixed remap to the same indices.
PREDICATES: tuple[str, ...] = (
    "left-above",
    "left-below",
    "left-of",
    "above",
    "inside",
    "surrounding",
    "below",
    "right-of",
    "right-above",
    "right-below",
)
PREDICATE_INDEX = {name: index for index, name in enumerate(PREDICATES)}
INSIDE_PREDICATE = PREDICATE_INDEX["inside"]
SURROUNDING_PREDICATE = PREDICATE_INDEX["surrounding"]

# The rEdge third column uses the same ten relative-position names as the predicates,
# so PREDICATES doubles as EDGE_TYPES.
EDGE_TYPES = PREDICATES

# Exterior doors are the only openings Graph2Plan represents, and only the one that
# becomes boundary[0:2] is visible to the model.
FRONT_DOOR_PREDICATE_COUNT = 2

# get_color_map(): the 18 RPLAN labels collapsed onto an 11-entry palette.
_PALETTE: tuple[tuple[int, int, int], ...] = (
    (244, 242, 229),  # 0 living room
    (253, 244, 171),  # 1 bedroom
    (234, 216, 214),  # 2 kitchen
    (205, 233, 252),  # 3 bathroom
    (208, 216, 135),  # 4 balcony
    (185, 231, 168),  # 5 balcony
    (249, 222, 189),  # 6 storage
    (79, 79, 79),     # 7 exterior wall
    (255, 225, 25),   # 8 front door
    (128, 128, 128),  # 9 interior wall
    (255, 255, 255),  # 10 white
)
_PALETTE_INDEX = (1, 2, 3, 4, 1, 2, 2, 2, 2, 5, 1, 6, 1, 10, 7, 8, 9, 10)

LABEL_RGB: dict[int, tuple[int, int, int]] = {
    index: _PALETTE[_PALETTE_INDEX[index] - 1] for index, _, _, _ in ROOM_LABEL
}
FRONT_DOOR_RGB = LABEL_RGB[15]
INTERIOR_DOOR_RGB = LABEL_RGB[17]

# Rural semantic code -> Graph2Plan rType.
#
# The rural corpus carries five coarse labels, but Graph2Plan splits bedrooms into
# MasterRoom(1)/ChildRoom(5)/StudyRoom(6)/SecondRoom(7)/GuestRoom(8) and has no
# sunroom class at all. The corpus never distinguishes a master bedroom, so every
# bedroom maps to the generic secondary bedroom rather than over-claiming
# MasterRoom's larger area prior, and the sunroom maps to Balcony(9) -- the closest
# official glazed public space. Neither choice invents information and both stay
# inside the model's 0..12 label space without touching the network.
RURAL_TO_GRAPH2PLAN: dict[str, int] = {
    "living_room": 0,   # LivingRoom
    "bedroom": 7,       # SecondRoom (generic secondary bedroom)
    "kitchen": 2,       # Kitchen
    "storage": 11,      # Storage
    "sunroom": 9,       # Balcony (nearest official glazed public space)
}

# Rooms whose presence makes a dwelling's main entrance plausible. Used only to
# rank candidate front doors; it never changes a room's label.
ENTRANCE_HOST_PRIORITY: tuple[str, ...] = ("living_room", "kitchen")


def room_type(semantic: str) -> int:
    """Return the Graph2Plan ``rType`` for a canonical rural room semantic."""

    try:
        value = RURAL_TO_GRAPH2PLAN[semantic]
    except KeyError as error:
        raise ValueError(f"GRAPH2PLAN_UNMAPPED_ROOM: {semantic}") from error
    if not 0 <= value <= ROOM_LABEL_MAX:
        raise ValueError(f"GRAPH2PLAN_LABEL_RANGE: {semantic} -> {value}")
    return value


def vocabulary() -> dict:
    """Return the public, versioned description of the label mapping."""

    return {
        "schema_version": "graph2plan-rural-vocabulary/1.0.0",
        "room_label": [
            {"index": index, "name": name, "is_public": bool(is_public), "texture": texture}
            for index, name, is_public, texture in ROOM_LABEL
        ],
        "room_type_max": ROOM_LABEL_MAX,
        "layout_image_labels": {
            "outside": OUTSIDE_LABEL,
            "exterior_wall": EXTERIOR_WALL_LABEL,
        },
        "predicates": list(PREDICATES),
        "edge_types": list(EDGE_TYPES),
        "rural_to_graph2plan": dict(RURAL_TO_GRAPH2PLAN),
        "unmapped_semantics": "GRAPH2PLAN_UNMAPPED_ROOM (conversion fails, never guesses)",
    }
