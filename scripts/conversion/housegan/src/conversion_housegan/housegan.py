"""Build owner-first edge loops consumed by the official House-GAN++ reader.

Geometry is derived from the shared canonical record, never from room bboxes.
Room adjacency means a shared boundary of positive length. Door connectivity
comes from the canonical opening relations, not from bbox proximity.
"""
from __future__ import annotations

import json
import math
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema import Draft202012Validator
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

from .vocabulary import ROOM_CLASS, room_class, vocabulary

EPS = 1e-6


def schema_document() -> dict:
    number = {'type': 'number', 'minimum': 0, 'maximum': 255}
    class_id = {'type': 'integer', 'enum': sorted(ROOM_CLASS.values())}
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        'title': 'HouseGAN rural v1', 'type': 'object', 'additionalProperties': False,
        'required': ['room_type', 'boxes', 'edges', 'ed_rm'],
        'properties': {
            'room_type': {'type': 'array', 'minItems': 1, 'items': class_id},
            'boxes': {'type': 'array', 'minItems': 1, 'items': {'type': 'array', 'minItems': 4, 'maxItems': 4, 'items': number}},
            'edges': {'type': 'array', 'minItems': 3, 'items': {
                'type': 'array', 'minItems': 6, 'maxItems': 6,
                'prefixItems': [number, number, number, number, class_id, {'type': 'integer', 'enum': [0, *sorted(ROOM_CLASS.values())]}],
                'items': False,
            }},
            'ed_rm': {'type': 'array', 'minItems': 3, 'items': {
                'type': 'array', 'minItems': 1, 'maxItems': 2, 'uniqueItems': True,
                'items': {'type': 'integer', 'minimum': 0},
            }},
        },
    }


def _ring(points: list, entity: str) -> list[tuple[float, float]]:
    if len(points) < 3 or not all(math.isfinite(float(v)) for p in points for v in p):
        raise ValueError(f'HOUSEGAN_POLYGON: {entity}')
    polygon = Polygon(points)
    if not polygon.is_valid or polygon.area <= EPS:
        raise ValueError(f'HOUSEGAN_POLYGON: {entity}')
    ring = list(orient(polygon, sign=1).exterior.coords)[:-1]
    if len(set(ring)) != len(ring):
        raise ValueError(f'HOUSEGAN_POLYGON: repeated vertices in {entity}')
    start = min(range(len(ring)), key=lambda i: ring[i])
    return ring[start:] + ring[:start]


def _room_edges(rings: list[list], polygons: list[Polygon], owner: int) -> list[tuple]:
    """Split collinear partial shared boundaries without losing owner loops."""
    result = []
    ring = rings[owner]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        line = LineString([a, b])
        cuts = {0.0, line.length}
        candidates = []
        for other, polygon in enumerate(polygons):
            if other == owner:
                continue
            common = line.intersection(polygon.boundary)
            if common.length <= EPS:
                continue
            candidates.append(other)
            pieces = list(common.geoms) if hasattr(common, 'geoms') else [common]
            for piece in pieces:
                if piece.geom_type == 'LineString':
                    for point in (piece.coords[0], piece.coords[-1]):
                        cuts.add(line.project(Point(point)))
        cuts = sorted(cuts)
        for low, high in pairwise(cuts):
            if high-low <= EPS:
                continue
            midpoint = line.interpolate((low+high)/2)
            neighbors = [i for i in candidates if polygons[i].boundary.distance(midpoint) <= EPS]
            if len(neighbors) > 1:
                raise ValueError('HOUSEGAN_NONMANIFOLD_BOUNDARY')
            result.append((tuple(line.interpolate(low).coords[0]), tuple(line.interpolate(high).coords[0]), neighbors[0] if neighbors else None))
    return result


def _door(element: dict, walls: dict, vertices: dict, relations: list, room_indices: dict, polygons: list) -> tuple:
    entity = element['id']
    related = [r for r in relations if r['wall_element_id'] == entity]
    room_ids = set()
    outside = False
    for relation in related:
        if relation.get('channels', {}).get('people') is not True:
            raise ValueError(f'HOUSEGAN_DOOR_RELATION: non-traversable {entity}')
        room_ids.add(relation['from_face_id'])
        if relation['to']['kind'] == 'face':
            room_ids.add(relation['to']['face_id'])
        else:
            outside = True
    if len(room_ids) != (1 if outside else 2) or not room_ids <= room_indices.keys():
        raise ValueError(f'HOUSEGAN_DOOR_RELATION: {entity}')
    wall = walls[element['host_wall_id']]
    width = float(wall['thickness_mm'])
    if not math.isfinite(width) or width <= 0:
        raise ValueError(f'HOUSEGAN_THICKNESS: {entity}')
    # Canonical segment_mm is rounded to mm. Reconstruct on the repaired host
    # centerline so diagonal doors do not drift to one side of the wall.
    start, end = vertices[wall['start_vertex_id']], vertices[wall['end_vertex_id']]
    dx, dy = end['x_mm']-start['x_mm'], end['y_mm']-start['y_mm']
    length = math.hypot(dx, dy)
    offset, opening_width = float(element['offset_from_start_mm']), float(element['width_mm'])
    if length <= EPS or not all(math.isfinite(v) for v in (offset, opening_width)) or offset < 0 or opening_width <= 0 or offset+opening_width > length+EPS:
        raise ValueError(f'HOUSEGAN_DOOR_GEOMETRY: {entity}')
    a = (start['x_mm']+dx*offset/length, start['y_mm']+dy*offset/length)
    b = (start['x_mm']+dx*(offset+opening_width)/length, start['y_mm']+dy*(offset+opening_width)/length)
    nx, ny = -dy/length, dx/length
    ring = [(a[0]+nx*width/2, a[1]+ny*width/2), (b[0]+nx*width/2, b[1]+ny*width/2),
            (b[0]-nx*width/2, b[1]-ny*width/2), (a[0]-nx*width/2, a[1]-ny*width/2)]
    side_rooms = {}
    for room_id in sorted(room_ids):
        index = room_indices[room_id]
        # Sample just inside the wall centerline on either side, independent of thickness.
        sides = [side for side, sign in ((0, 1), (2, -1)) if polygons[index].contains(Point(
            (a[0]+b[0])/2 + sign*nx*.001, (a[1]+b[1])/2 + sign*ny*.001))]
        if len(sides) != 1 or sides[0] in side_rooms:
            raise ValueError(f'HOUSEGAN_DOOR_RELATION: ambiguous side for {entity}')
        side_rooms[sides[0]] = index
    edges = [(a, b, side_rooms.get(i)) for i, (a, b) in enumerate(zip(ring, ring[1:]+ring[:1]))]
    return ring, edges, 15 if outside else 17, sorted(room_ids)


def build_housegan(canonical: dict) -> tuple[dict, dict]:
    rooms = sorted(canonical['rooms'], key=lambda r: r['id'])
    if not rooms:
        raise ValueError('HOUSEGAN_EMPTY_ROOMS')
    if sum(bool(f.get('face_ids') or f.get('wall_ids')) for f in canonical['floors']) > 1:
        raise ValueError('HOUSEGAN_MULTIFLOOR: 请按楼层分别转换')
    for room in rooms:
        if room.get('properties', {}).get('holes'):
            raise ValueError(f"HOUSEGAN_HOLES: {room['id']}")
    rings = [_ring(r['polygon_mm'], r['id']) for r in rooms]
    polygons = [Polygon(r) for r in rings]
    for i, polygon in enumerate(polygons):
        if any(polygon.intersection(other).area > EPS for other in polygons[i+1:]):
            raise ValueError('HOUSEGAN_OVERLAPPING_ROOMS')
    indices = {r['id']: i for i, r in enumerate(rooms)}
    types = [room_class(r.get('original_function_code'), r.get('display_name', '')) for r in rooms]
    nodes = [{'index': i, 'kind': 'room', 'source_id': r['id'], 'original_function_code': r.get('original_function_code'),
              'display_name': r.get('display_name', ''), 'class_id': types[i]} for i, r in enumerate(rooms)]
    loops = [_room_edges(rings, polygons, i) for i in range(len(rooms))]
    walls = {w['id']: w for w in canonical['walls']}
    ignored = []
    for element in sorted(canonical['wall_elements'], key=lambda e: e['id']):
        if element['element_type'] not in {'interior_door', 'exterior_door', 'passage'}:
            ignored.append(element['id'])
            continue
        ring, edges, label, room_ids = _door(element, walls, canonical['vertices'], canonical['relations'], indices, polygons)
        nodes.append({'index': len(types), 'kind': 'door', 'source_id': element['id'],
                      'original_element_type': element.get('source_element_type', element['element_type']),
                      'host_wall_id': element['host_wall_id'], 'room_ids': room_ids, 'class_id': label})
        rings.append(ring)
        loops.append(edges)
        types.append(label)
    # Include door thickness in the extent so exterior doors never get clipped.
    north = float(canonical.get('site', {}).get('north_angle_deg', 0) or 0)
    if not math.isfinite(north):
        raise ValueError('HOUSEGAN_ROTATION: north angle must be finite')
    angle = -math.radians(north)
    cosine, sine = math.cos(angle), math.sin(angle)
    def rotate(p):
        return p[0]*cosine-p[1]*sine, p[0]*sine+p[1]*cosine
    points = [rotate(p) for ring in rings for p in ring]
    x0, y0 = min(p[0] for p in points), min(p[1] for p in points)
    x1, y1 = max(p[0] for p in points), max(p[1] for p in points)
    scale = 239 / max(x1-x0, y1-y0)
    ox, oy = 127.5-(x0+x1)*scale/2, 127.5+(y0+y1)*scale/2
    def project(p):
        x, y = rotate(p)
        return [round(x*scale+ox, 10), round(oy-y*scale, 10)]
    boxes = []
    for ring in rings:
        projected = [project(p) for p in ring]
        boxes.append([min(p[0] for p in projected), min(p[1] for p in projected), max(p[0] for p in projected), max(p[1] for p in projected)])
    edges, associations = [], []
    for owner, loop in enumerate(loops):
        for a, b, neighbor in loop:
            edges.append([*project(a), *project(b), types[owner], types[neighbor] if neighbor is not None else 0])
            associations.append([owner] if neighbor is None else [owner, neighbor])
    data = {'room_type': types, 'boxes': boxes, 'edges': edges, 'ed_rm': associations}
    Draft202012Validator(schema_document()).validate(data)
    validate_integrity(data)
    return data, {
        'schema_version': 'housegan-source-mapping/1.0.0', 'building_id': canonical['building_id'],
        'nodes': nodes, 'ignored_wall_element_ids': ignored,
        'ignored_outside_region_ids': sorted(r['id'] for r in canonical['outside_regions']),
        'transform': {'grid_size': 256, 'padding': 8, 'rotation_deg': math.degrees(angle),
                      'scale_mm_to_pixel': scale, 'offset_px': [ox, oy], 'y_axis': 'down',
                      'formula': 'rotate source by rotation_deg; x_px=x*scale+offset[0]; y_px=offset[1]-y*scale'},
        'warnings': [f"UNKNOWN_ROOM: {n['source_id']}" for n in nodes if n['class_id'] == 16],
    }


def validate_integrity(data: dict) -> None:
    """Check the official owner-only mask construction, including room overwrite."""
    size = len(data['room_type'])
    if len(data['boxes']) != size or len(data['edges']) != len(data['ed_rm']):
        raise ValueError('HOUSEGAN_ARRAY_LENGTH')
    owned = [[] for _ in range(size)]
    for edge, ids in zip(data['edges'], data['ed_rm']):
        if not ids or any(i < 0 or i >= size for i in ids):
            raise ValueError('HOUSEGAN_NODE_INDEX')
        if edge[4] != data['room_type'][ids[0]] or edge[5] != (data['room_type'][ids[1]] if len(ids) == 2 else 0):
            raise ValueError('HOUSEGAN_EDGE_TYPE')
        owned[ids[0]].append(edge[:4])
    boxes = np.asarray(data['boxes'], dtype=float)
    if not np.isfinite(boxes).all() or np.any(boxes[:, :2] >= boxes[:, 2:]):
        raise ValueError('HOUSEGAN_BOX')
    # reader() centers in normalized coordinates, then build_graph() rasterizes.
    shift = (boxes[:, :2].min(axis=0) + boxes[:, 2:].max(axis=0))/2 - 128
    occupancy = np.zeros((64, 64), dtype=np.int32)
    for i, edges in enumerate(owned):
        if len(edges) < 3 or any(a[2:] != b[:2] for a, b in zip(edges, edges[1:]+edges[:1])):
            raise ValueError(f'HOUSEGAN_OPEN_LOOP: {i}')
        if any(e[:2] == e[2:] for e in edges):
            raise ValueError(f'HOUSEGAN_COLLAPSED_EDGE: {i}')
        points = np.asarray([e[:2] for e in edges])
        if not np.isfinite(points).all():
            raise ValueError(f'HOUSEGAN_NONFINITE_EDGE: {i}')
        expected_box = np.concatenate((points.min(axis=0), points.max(axis=0)))
        if not np.allclose(boxes[i], expected_box, rtol=0, atol=1e-8):
            raise ValueError(f'HOUSEGAN_BOX: {i} does not bound its polygon')
        mask = Image.new('L', (256, 256))
        ImageDraw.Draw(mask).polygon([tuple(p-shift) for p in points], fill=255)
        visible = np.asarray(mask.resize((64, 64))) > 0
        if not visible.any():
            raise ValueError(f'HOUSEGAN_EMPTY_MASK: {i}')
        if data['room_type'][i] not in {15, 17}:
            occupancy[visible] = i+1
    for i, label in enumerate(data['room_type']):
        if label not in {15, 17} and not (occupancy == i+1).any():
            raise ValueError(f'HOUSEGAN_EMPTY_MASK: {i} after overlap removal')


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def write_artifacts(canonical: dict, output: Path) -> dict:
    data, mapping = build_housegan(canonical)
    output.mkdir()
    for name, value in [('housegan.json', data), ('mapping.json', mapping),
                        ('vocabulary.json', vocabulary()), ('housegan.schema.json', schema_document())]:
        write_json(output/name, value)
    return {'grid_size': 256, 'vocabulary_version': 'housegan-rural-vocabulary/1.0.0'}
