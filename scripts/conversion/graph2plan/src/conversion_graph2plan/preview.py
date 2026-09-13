"""Data-check renders for converted Graph2Plan records.

The left panel mirrors ``Network/model/floorplan.py::vis_fp`` so a rural plan and an
RPLAN plan can be compared side by side: the envelope is filled with the LivingRoom
colour, bboxes are painted in ``order`` (skipping LivingRoom, which stays background),
the envelope is outlined in the ExteriorWall colour and the front door in the
FrontDoor colour. The right panel draws the room graph, with the reused door-mediated
edges solid and the extra upstream bbox-collision pairs dashed, so the one deliberate
deviation from RPLAN is visible per building.

Both panels are GRID_SIZE square and use the exported grid coordinates one-to-one, so
a pixel in the render is the coordinate written into ``data_*.mat``.
"""

from __future__ import annotations

import math

from PIL import Image, ImageDraw, ImageFont

from .graph2plan import GRID_SIZE, Graph2PlanSample
from .vocabulary import FRONT_DOOR_RGB, LABEL_RGB

BOX_OUTLINE_RGB = LABEL_RGB[17]
GRID_RGB = (231, 231, 231)
FRAME_RGB = (160, 160, 160)
BBOX_ONLY_RGB = (219, 68, 55)
EDGE_RGB = (31, 119, 180)
NODE_RGB = (40, 40, 40)

PANEL = GRID_SIZE
GUTTER = 16
HEADER = 34


def _font(size: int = 13) -> ImageFont.ImageFont:
    for candidate in ("arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _draw_grid(draw: ImageDraw.ImageDraw) -> None:
    for step in range(0, GRID_SIZE + 1, 64):
        draw.line([(step, 0), (step, GRID_SIZE)], fill=GRID_RGB)
        draw.line([(0, step), (GRID_SIZE, step)], fill=GRID_RGB)
    draw.rectangle([(0, 0), (GRID_SIZE - 1, GRID_SIZE - 1)], outline=FRAME_RGB)


def _envelope(sample: Graph2PlanSample) -> list[tuple[int, int]]:
    return [(row[0], row[1]) for row in sample.boundary]


def _semantic_panel(sample: Graph2PlanSample) -> Image.Image:
    """vis_fp equivalent: bboxes in ``order``, LivingRoom left as background."""

    panel = Image.new("RGBA", (PANEL, PANEL), (255, 255, 255, 255))
    draw = ImageDraw.Draw(panel)
    _draw_grid(draw)
    points = _envelope(sample)
    draw.polygon(points, fill=LABEL_RGB[0])
    by_index = dict(enumerate(sample.rooms))
    for room_index in sample.order:
        room = by_index[room_index - 1]
        if room["label"] == 0:
            continue
        x0, y0, x1, y1 = room["bbox"]
        draw.rectangle(
            [(x0, y0), (x1 - 1, y1 - 1)],
            fill=LABEL_RGB[room["label"]],
            outline=BOX_OUTLINE_RGB,
        )
        draw.text(
            ((x0 + x1) // 2 - 4, (y0 + y1) // 2 - 7),
            str(room_index - 1),
            fill=(0, 0, 0),
            font=_font(),
        )
    draw.line(points + [points[0]], fill=LABEL_RGB[14], width=3)
    draw.line([tuple(point) for point in sample.door_grid], fill=FRONT_DOOR_RGB, width=4)
    draw.text((5, 4), "vis_fp layout", fill=(0, 0, 0), font=_font())
    return panel


def _dashed_line(draw: ImageDraw.ImageDraw, start, end) -> None:
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    if length == 0:
        return
    steps = max(2, int(length // 9))
    for step in range(steps):
        if step % 2:
            continue
        a, b = step / steps, (step + 1) / steps
        draw.line(
            [
                (round(start[0] + (end[0] - start[0]) * a), round(start[1] + (end[1] - start[1]) * a)),
                (round(start[0] + (end[0] - start[0]) * b), round(start[1] + (end[1] - start[1]) * b)),
            ],
            fill=BBOX_ONLY_RGB,
            width=2,
        )


def _graph_panel(sample: Graph2PlanSample) -> Image.Image:
    """Room graph: door-mediated edges solid, extra bbox-collision pairs dashed."""

    panel = Image.new("RGBA", (PANEL, PANEL), (255, 255, 255, 255))
    draw = ImageDraw.Draw(panel)
    _draw_grid(draw)
    points = _envelope(sample)
    draw.line(points + [points[0]], fill=(205, 205, 205), width=2)

    centres = []
    for room in sample.rooms:
        x0, y0, x1, y1 = room["bbox"]
        centres.append((round((x0 + x1) / 2), round((y0 + y1) / 2)))
        draw.rectangle([(x0, y0), (x1 - 1, y1 - 1)], outline=(178, 178, 178))

    for edge in sample.edges:
        draw.line([centres[edge["u"]], centres[edge["v"]]], fill=EDGE_RGB, width=3)
    for u, v in sample.comparison["bbox_only"]:
        _dashed_line(draw, centres[u], centres[v])

    for index, centre in enumerate(centres):
        draw.ellipse(
            [centre[0] - 4, centre[1] - 4, centre[0] + 4, centre[1] + 4], fill=NODE_RGB
        )
        draw.text((centre[0] + 5, centre[1] - 16), str(index), fill=(0, 0, 0), font=_font())

    draw.line([tuple(point) for point in sample.door_grid], fill=FRONT_DOOR_RGB, width=4)
    draw.text(
        (5, 4),
        f"door-edges={len(sample.edges)} bbox-only={len(sample.comparison['bbox_only'])}",
        fill=(0, 0, 0),
        font=_font(),
    )
    return panel


def render_preview(sample: Graph2PlanSample) -> Image.Image:
    """Return the two-panel data-check image for one sample."""

    canvas = Image.new("RGBA", (PANEL * 2 + GUTTER, HEADER + PANEL), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (6, 4),
        f"{sample.building_id} | rooms={len(sample.rooms)} grid=256 y-down "
        f"entrances={len(sample.entrances)}",
        fill=(0, 0, 0),
        font=_font(),
    )
    if sample.warnings:
        draw.text((6, 19), f"! {sample.warnings[0]}", fill=(180, 60, 0), font=_font(11))
    canvas.alpha_composite(_semantic_panel(sample), (0, HEADER))
    canvas.alpha_composite(_graph_panel(sample), (PANEL + GUTTER, HEADER))
    return canvas.convert("RGB")
