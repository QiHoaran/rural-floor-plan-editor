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
