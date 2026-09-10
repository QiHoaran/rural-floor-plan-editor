from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from conversion_shared.records import build_records
from PIL import Image, ImageDraw
from shapely.geometry import Polygon
from test_records import sample_document, source_for


def two_rooms():
    doc = sample_document()
    doc['vertices'].update(e={'x_mm': 7000, 'y_mm': 0}, f={'x_mm': 7000, 'y_mm': 3000})
    for name, start, end in [('bottom2', 'b', 'e'), ('right2', 'e', 'f'), ('top2', 'f', 'c')]:
        doc['walls'][name] = dict(doc['walls']['bottom'], start_vertex_id=start, end_vertex_id=end)
    doc['faces']['sun'] = dict(doc['faces']['room'], boundary_vertex_ids=['b', 'e', 'f', 'c'], function_code='sunroom', display_name='阳光房')
    doc['wall_elements']['inside'] = dict(doc['wall_elements']['door'], element_type='interior_door', host_wall_id='right')
    doc['floors'][0].update(wall_ids=list(doc['walls']), face_ids=list(doc['faces']))
    return doc


def cross_rooms():
    """Middle room touching three rooms, with two front doors and one interior door."""
    doc = sample_document()
    doc['vertices'] = {
        'a': {'x_mm': 0, 'y_mm': 0}, 'b': {'x_mm': 4000, 'y_mm': 0},
        'c': {'x_mm': 4000, 'y_mm': 3000}, 'd': {'x_mm': 0, 'y_mm': 3000},
        'e': {'x_mm': -2000, 'y_mm': 0}, 'f': {'x_mm': -2000, 'y_mm': 3000},
        'g': {'x_mm': 4000, 'y_mm': 5000}, 'h': {'x_mm': 0, 'y_mm': 5000},
        'i': {'x_mm': 6000, 'y_mm': 0}, 'j': {'x_mm': 6000, 'y_mm': 3000},
    }
    doc['walls'] = {
        'bottom': {'start_vertex_id': 'a', 'end_vertex_id': 'b', 'wall_type': 'exterior', 'thickness_mm': 240},
        'left': {'start_vertex_id': 'd', 'end_vertex_id': 'a', 'wall_type': 'interior', 'thickness_mm': 120},
    }
    doc['wall_elements'] = {
        'front1': {'element_type': 'exterior_door', 'host_wall_id': 'bottom', 'offset_from_start_mm': 500, 'width_mm': 900, 'height_mm': 2100, 'sill_height_mm': 0},
        'front2': {'element_type': 'exterior_door', 'host_wall_id': 'bottom', 'offset_from_start_mm': 2500, 'width_mm': 900, 'height_mm': 2100, 'sill_height_mm': 0},
        'inner': {'element_type': 'interior_door', 'host_wall_id': 'left', 'offset_from_start_mm': 500, 'width_mm': 800, 'height_mm': 2100, 'sill_height_mm': 0},
    }
    doc['faces'] = {
        'left': {'boundary_vertex_ids': ['e', 'a', 'd', 'f'], 'function_code': 'bedroom', 'display_name': '卧室'},
        'middle': {'boundary_vertex_ids': ['a', 'b', 'c', 'd'], 'function_code': 'living_room', 'display_name': '客厅'},
        'right': {'boundary_vertex_ids': ['b', 'i', 'j', 'c'], 'function_code': 'custom', 'display_name': '厨房'},
        'top': {'boundary_vertex_ids': ['d', 'c', 'g', 'h'], 'function_code': 'custom', 'display_name': '杂物间'},
    }
    doc['relations'] = [
        {'relation_type': 'opening', 'wall_element_id': 'front1', 'from_face_id': 'middle', 'to': {'kind': 'outside'}, 'channels': {'people': True, 'air': True, 'light': True}},
        {'relation_type': 'opening', 'wall_element_id': 'front2', 'from_face_id': 'middle', 'to': {'kind': 'outside'}, 'channels': {'people': True, 'air': True, 'light': True}},
        {'relation_type': 'opening', 'wall_element_id': 'inner', 'from_face_id': 'middle', 'to': {'kind': 'face', 'face_id': 'left'}, 'channels': {'people': True, 'air': True, 'light': False}},
    ]
    doc['floors'] = [{'floor_id': 'floor_1', 'wall_ids': ['bottom', 'left'], 'face_ids': ['left', 'middle', 'right', 'top']}]
    return doc


def complex_rooms():
    """Cross rooms plus a detached shed, so one node is isolated and components split."""
    doc = cross_rooms()
    doc['vertices'].update(
        k={'x_mm': 0, 'y_mm': 6000}, l={'x_mm': 1000, 'y_mm': 6000},
        m={'x_mm': 1000, 'y_mm': 7000}, n={'x_mm': 0, 'y_mm': 7000},
    )
    doc['faces']['shed'] = {'boundary_vertex_ids': ['k', 'l', 'm', 'n'], 'function_code': 'bedroom', 'display_name': '卧室'}
    doc['floors'][0]['face_ids'] = ['left', 'middle', 'right', 'shed', 'top']
    return doc


class HouseGANTests(unittest.TestCase):
    def converter(self):
        self.assertIsNotNone(importlib.util.find_spec('conversion_housegan'), 'HouseGAN workspace package must be available')
        from conversion_housegan.housegan import build_housegan
        return build_housegan

    def convert(self, doc):
        return self.converter()(build_records(source_for(doc)).canonical)

    def test_official_reader_masks_and_graph(self):
        data, mapping = self.convert(two_rooms())
        self.assertEqual(data['room_type'], [2, 18, 15, 17])
        self.assertEqual([n['source_id'] for n in mapping['nodes']], ['room', 'sun', 'door', 'inside'])
        # Official reader divides by 256; build_graph uses owner-only edges for masks.
        edges = np.asarray(data['edges'])[:, :4] / 256
        boxes = np.asarray(data['boxes']) / 256
        shift = (boxes[:, :2].min(axis=0) + boxes[:, 2:].max(axis=0))/2 - .5
        edges[:, :2] -= shift
        edges[:, 2:] -= shift
        self.assertEqual(len(edges), len(data['ed_rm']))
        masks = []
        for node in range(4):
            owned = [edge for edge, ids in zip(edges, data['ed_rm']) if ids[0] == node]
            self.assertGreaterEqual(len(owned), 4)
            for a, b in zip(owned, owned[1:] + owned[:1]):
                np.testing.assert_array_equal(a[2:], b[:2])
            mask = Image.new('L', (256, 256))
            ImageDraw.Draw(mask).polygon([(256*e[0], 256*e[1]) for e in owned], fill=255)
            masks.append(np.asarray(mask.resize((64, 64))) > 0)
        occupancy = np.zeros((64, 64), dtype=int)
        for node in (0, 1):
            occupancy[masks[node]] = node + 1
        for node in (0, 1):
            self.assertTrue((occupancy == node+1).any())
        self.assertTrue(all(mask.any() for mask in masks))
        positives = {(a, b) for a in range(4) for b in range(a+1, 4) if any(a in ids and b in ids for ids in data['ed_rm'])}
        self.assertEqual(positives, {(0, 1), (0, 2), (0, 3), (1, 3)})
        self.assertGreater(data['boxes'][2][1], data['boxes'][0][1])  # south door stays at image bottom
        self.assertTrue(np.isfinite(np.asarray(data['boxes'])).all())

    def test_semantics_unknown_and_determinism(self):
        doc = sample_document()
        for code, name, expected in [('bedroom', '卧室', 3), ('living_room', '客厅', 1), ('kitchen', '厨房', 2), ('storage', '杂物间', 10), ('sunroom', '阳光房', 18), ('custom', '猪圈', 16), (None, '', 16), ('bathroom', '卫生间', 4)]:
            with self.subTest(code=code):
                doc['faces']['room'].update(function_code=code, display_name=name)
                data, mapping = self.convert(doc)
                self.assertEqual(data['room_type'][0], expected)
                self.assertEqual(mapping['nodes'][0]['original_function_code'], code)
        before = copy.deepcopy(doc)
        first = self.convert(doc)
        for key in ('vertices', 'walls', 'faces', 'wall_elements'):
            doc[key] = dict(reversed(list(doc[key].items())))
        self.assertEqual(first, self.convert(doc))
        self.assertEqual(before, doc)

    def test_passages_windows_and_concave_polygon(self):
        doc = two_rooms()
        doc['wall_elements']['inside']['element_type'] = 'passage'
        doc['wall_elements']['window'] = dict(doc['wall_elements']['door'], element_type='exterior_window', host_wall_id='top')
        data, mapping = self.convert(doc)
        self.assertEqual(data['room_type'], [2, 18, 15, 17])
        self.assertEqual(mapping['nodes'][-1]['original_element_type'], 'passage')
        doc = sample_document()
        doc['vertices'].update(e={'x_mm': 2000, 'y_mm': 3000}, f={'x_mm': 2000, 'y_mm': 1500}, g={'x_mm': 0, 'y_mm': 1500})
        doc['faces']['room']['boundary_vertex_ids'] = ['a', 'b', 'c', 'e', 'f', 'g']
        doc['walls'] = {'bottom': doc['walls']['bottom']}
        doc['floors'][0]['wall_ids'] = ['bottom']
        data, _ = self.convert(doc)
        self.assertEqual(sum(ids[0] == 0 for ids in data['ed_rm']), 6)

    def test_rejects_multifloor_holes_and_invalid_door(self):
        for mutate, message in [
            (lambda d: d['floors'].append(dict(d['floors'][0], floor_id='second')), 'MULTIFLOOR'),
            (lambda d: d['faces']['room'].update(holes=[[1, 2, 3]]), 'HOLES'),
            (lambda d: d['walls']['bottom'].update(thickness_mm=0), 'THICKNESS'),
            (lambda d: d['relations'][0]['channels'].update(people=False), 'DOOR_RELATION'),
        ]:
            doc = sample_document()
            mutate(doc)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.convert(doc)

    def test_partial_shared_boundary_and_corner_contact(self):
        doc = two_rooms()
        doc['wall_elements'] = {}
        doc['relations'] = []
        doc['vertices']['f']['y_mm'] = 1500
        doc['vertices']['g'] = {'x_mm': 4000, 'y_mm': 1500}
        doc['walls']['top2']['end_vertex_id'] = 'g'
        doc['faces']['sun']['boundary_vertex_ids'] = ['b', 'e', 'f', 'g']
        data, _ = self.convert(doc)
        self.assertEqual(sum(ids[0] == 0 for ids in data['ed_rm']), 5)
        self.assertEqual(sum(ids == [0, 1] for ids in data['ed_rm']), 1)
        self.assertEqual(sum(ids == [1, 0] for ids in data['ed_rm']), 1)
        canonical = build_records(source_for(doc)).canonical
        canonical['rooms'][1]['polygon_mm'] = [[4000, 3000], [6000, 3000], [6000, 5000], [4000, 5000]]
        data, _ = self.converter()(canonical)
        self.assertTrue(all(len(ids) == 1 for ids in data['ed_rm']))

    def test_conversion_graph_multibranch_and_multiple_front_doors(self):
        data, mapping = self.convert(cross_rooms())
        graph = mapping['conversion_graph']
        self.assertEqual(data['room_type'], [3, 1, 2, 10, 15, 15, 17])
        self.assertEqual([node['source_id'] for node in mapping['nodes']],
                         ['left', 'middle', 'right', 'top', 'front1', 'front2', 'inner'])
        # The middle room is the multi-branch node: three rooms and three doors.
        self.assertEqual(graph['nodes'][1]['neighbors'], [0, 2, 3, 4, 5, 6])
        self.assertEqual(graph['totals'], {'room_room': 3, 'room_interior_door': 2, 'room_front_door': 2,
                                            'max_degree': 6, 'components': 1, 'isolated_node_indices': []})
        for node in graph['nodes']:
            for neighbor in node['neighbors']:
                self.assertIn(node['index'], graph['nodes'][neighbor]['neighbors'])
        # An interior door is adjacent to both of its rooms, a front door to one.
        self.assertEqual([(item['a'], item['b'], item['kind']) for item in graph['adjacencies']],
                         [(0, 1, 'room-room'), (0, 6, 'room-interior-door'),
                          (1, 2, 'room-room'), (1, 3, 'room-room'),
                          (1, 4, 'room-front-door'), (1, 5, 'room-front-door'),
                          (1, 6, 'room-interior-door')])
        for item in graph['adjacencies']:
            if item['kind'] == 'room-room':
                self.assertEqual(item['segments'], 1)
                self.assertGreater(item['length_mm'], 0)

    def test_multiple_exterior_doors_create_no_outside_node(self):
        doc = sample_document()
        doc['wall_elements']['door2'] = {**doc['wall_elements']['door'], 'host_wall_id': 'top', 'offset_from_start_mm': 500}
        doc['relations'].append({**doc['relations'][0], 'wall_element_id': 'door2'})
        data, mapping = self.convert(doc)
        self.assertEqual(data['room_type'], [2, 15, 15])
        self.assertEqual([node['kind'] for node in mapping['nodes']], ['room', 'door', 'door'])
        self.assertEqual([node['source_id'] for node in mapping['nodes']], ['room', 'door', 'door2'])
        self.assertEqual([node['class_id'] for node in mapping['nodes']], [2, 15, 15])
        graph = mapping['conversion_graph']
        self.assertEqual(graph['nodes'][1]['neighbors'], [0])
        self.assertEqual(graph['nodes'][2]['neighbors'], [0])
        self.assertEqual(graph['totals']['room_front_door'], 2)
        self.assertTrue(all(len(ids) <= 2 for ids in data['ed_rm']))
        self.assertEqual(sum(ids == [1, 0] for ids in data['ed_rm']), 1)
        self.assertEqual(sum(ids == [2, 0] for ids in data['ed_rm']), 1)

    def test_outside_regions_are_never_nodes(self):
        baseline, _ = self.convert(sample_document())
        doc = sample_document()
        doc['outside_regions'] = {'yard': {'region_type': 'courtyard', 'boundary_vertex_ids': ['a', 'b', 'c', 'd']}}
        data, mapping = self.convert(doc)
        self.assertEqual(data, baseline)
        self.assertEqual(mapping['ignored_outside_region_ids'], ['yard'])
        self.assertNotIn('yard', [node['source_id'] for node in mapping['nodes']])
        self.assertEqual(len(mapping['conversion_graph']['nodes']), len(mapping['nodes']))

    def test_conversion_graph_matches_shapely_ground_truth(self):
        doc = complex_rooms()
        data, mapping = self.convert(doc)
        graph = mapping['conversion_graph']
        canonical = build_records(source_for(doc)).canonical
        rooms = sorted(canonical['rooms'], key=lambda room: room['id'])
        polygons = [Polygon(room['polygon_mm']) for room in rooms]
        truth = {(i, j) for i in range(len(rooms)) for j in range(i+1, len(rooms))
                 if polygons[i].boundary.intersection(polygons[j].boundary).length > 1e-6}
        reported = {(item['a'], item['b']) for item in graph['adjacencies'] if item['kind'] == 'room-room'}
        from_edges = {tuple(sorted(ids)) for ids in data['ed_rm'] if len(ids) == 2 and max(ids) < len(rooms)}
        self.assertEqual(reported, truth)
        self.assertEqual(from_edges, truth)
        self.assertEqual(truth, {(0, 1), (1, 2), (1, 4)})
        self.assertEqual(graph['totals']['isolated_node_indices'], [3])
        self.assertEqual(graph['totals']['components'], 2)
        self.assertIn('ISOLATED_NODE: 3 shed', mapping['warnings'])

    def test_conversion_graph_isolated_room_warns_not_errors(self):
        doc = sample_document()
        doc['wall_elements'] = {}
        doc['relations'] = []
        data, mapping = self.convert(doc)
        self.assertEqual(data['room_type'], [2])
        graph = mapping['conversion_graph']
        self.assertEqual(graph['adjacencies'], [])
        self.assertEqual(graph['totals']['isolated_node_indices'], [0])
        self.assertEqual(graph['totals']['max_degree'], 0)
        self.assertIn('ISOLATED_NODE: 0 room', mapping['warnings'])

    def test_rejects_duplicate_and_mismatched_adjacency(self):
        from conversion_housegan.housegan import _check_loops, _conversion_graph
        loop = [((0.0, 0.0), (1.0, 0.0), None), ((1.0, 0.0), (0.0, 0.0), None)]
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_EDGE'):
            _check_loops([loop], [{'index': 0, 'source_id': 'room'}])
        nodes = [{'index': 0, 'source_id': 'a'}, {'index': 1, 'source_id': 'b'}]
        adjacent = [Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]), Polygon([(1, 0), (2, 0), (2, 1), (1, 1)])]
        with self.assertRaisesRegex(ValueError, 'MISSING_ADJACENCY'):
            _conversion_graph(nodes, [[], []], adjacent, 2)
        disjoint = [Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]), Polygon([(5, 0), (6, 0), (6, 1), (5, 1)])]
        with self.assertRaisesRegex(ValueError, 'SPURIOUS_ADJACENCY'):
            _conversion_graph(nodes, [[((0.0, 0.0), (1.0, 0.0), 1)], []], disjoint, 2)

    def test_cli_print_adjacency_stays_off_stdout(self):
        self.converter()
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'building.json'
            target = Path(root) / 'HouseGAN'
            doc = sample_document()
            doc['workflow']['status'] = 'complete'
            source.write_text(json.dumps(doc), encoding='utf-8')
            cmd = [sys.executable, '-m', 'conversion_housegan.cli', '--input', str(source),
                   '--output', str(target), '--print-adjacency']
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines(), [f'HouseGAN: {target}'])
            self.assertIn('room-front-door', result.stderr)
            self.assertIn('totals:', result.stderr)

    def test_external_passage_and_rotation(self):
        doc = sample_document()
        doc['wall_elements']['door']['element_type'] = 'passage'
        doc['site']['north_angle_deg'] = 90
        data, mapping = self.convert(doc)
        self.assertEqual(data['room_type'], [2, 15])
        self.assertEqual(mapping['nodes'][-1]['original_element_type'], 'passage')
        self.assertLess(data['boxes'][1][0], data['boxes'][0][0])
        self.assertEqual(mapping['transform']['rotation_deg'], -90)

    def test_diagonal_door_preserves_submillimeter_centerline(self):
        doc = sample_document()
        for vertex in doc['vertices'].values():
            x, y = vertex['x_mm'], vertex['y_mm']
            vertex.update(x_mm=round(.8*x-.6*y), y_mm=round(.6*x+.8*y))
        doc['wall_elements']['door'].update(offset_from_start_mm=1001, width_mm=901)
        data, mapping = self.convert(doc)
        self.assertEqual(data['room_type'], [2, 15])
        edge = next(e for e, ids in zip(data['edges'], data['ed_rm']) if ids[0] == 1)
        length = np.linalg.norm(np.asarray(edge[:2])-np.asarray(edge[2:4]))
        self.assertAlmostEqual(length/mapping['transform']['scale_mm_to_pixel'], 901, places=6)

    def test_invalid_payload_checks(self):
        self.converter()
        from conversion_housegan.housegan import validate_integrity
        data, _ = self.convert(sample_document())
        for mutate, message in [
            (lambda d: d['boxes'][0].__setitem__(0, 250), 'BOX'),
            (lambda d: d['edges'][0].__setitem__(4, 18), 'EDGE_TYPE'),
            (lambda d: d['ed_rm'][0].__setitem__(0, 50), 'NODE_INDEX'),
            (lambda d: d['edges'][0].__setitem__(2, 100), 'OPEN_LOOP'),
        ]:
            broken = copy.deepcopy(data)
            mutate(broken)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                validate_integrity(broken)

    def test_empty_and_nonfinite_geometry(self):
        canonical = build_records(source_for(sample_document())).canonical
        canonical['rooms'] = []
        with self.assertRaisesRegex(ValueError, 'EMPTY_ROOMS'):
            self.converter()(canonical)
        canonical = build_records(source_for(sample_document())).canonical
        canonical['site']['north_angle_deg'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'ROTATION'):
            self.converter()(canonical)

    def test_cli_publishes_manifest_and_refuses_overwrite(self):
        self.converter()
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'building.json'
            target = Path(root) / '中文 output'
            doc = sample_document()
            doc['workflow']['status'] = 'complete'
            source.write_text(json.dumps(doc), encoding='utf-8')
            original = source.read_bytes()
            cmd = [sys.executable, '-m', 'conversion_housegan.cli', '--input', str(source), '--output', str(target)]
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual({p.name for p in target.iterdir()}, {'housegan.json', 'mapping.json', 'vocabulary.json', 'housegan.schema.json', 'conversion.json'})
            import hashlib
            manifest = json.loads((target / 'conversion.json').read_text())
            for item in manifest['artifacts']:
                self.assertEqual(item['sha256'], hashlib.sha256((target/item['path']).read_bytes()).hexdigest())
            self.assertEqual(source.read_bytes(), original)
            self.assertNotEqual(subprocess.run(cmd, capture_output=True, check=False).returncode, 0)
