// @vitest-environment node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { ProjectService } from '../../server/projectService.ts';
import { ConversionService } from '../../server/conversions/service.ts';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { previewOrthogonalRepair } from '../../src/editor/commands/orthogonalRepair.ts';
import { prepareExportDocument } from '../../src/editor/domain/exportUtils.ts';

const python = path.resolve('scripts/conversion/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
it.skipIf(!existsSync(python))('quarantines a 1 mm diagonal and converts again after the editor repair', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orthogonal-conversion-'));
  try {
    let doc = createEmptyBuilding('orthogonal', '');
    doc.metadata.status = 'complete'; doc.workflow.status = 'complete';
    doc.vertices = { a: { x_mm: 100, y_mm: 200 }, b: { x_mm: 4100, y_mm: 200 }, c: { x_mm: 4100, y_mm: 3200 }, d: { x_mm: 100, y_mm: 3200 } };
    for (const [id, start, end] of [['0', 'a', 'b'], ['1', 'b', 'c'], ['2', 'c', 'd'], ['3', 'd', 'a']]) doc.walls[id] = {
      start_vertex_id: start, end_vertex_id: end, wall_type: 'exterior', thickness_mm: 200, height_mm: 2800, material_type: 'brick',
    };
    doc.faces.room = { boundary_vertex_ids: ['a', 'b', 'c', 'd'], area_mm2: 12000000, function_code: 'bedroom', display_name: '卧室', color: '#eee', local_name: '' };
    doc.wall_elements.door = { element_type: 'exterior_door', host_wall_id: '0', offset_from_start_mm: 1000, width_mm: 901, height_mm: 2100, sill_height_mm: 0, status: 'valid' };
    doc.relations = [{ relation_type: 'opening', wall_element_id: 'door', from_face_id: 'room', to: { kind: 'outside' }, channels: { people: true, air: true, light: true } }];
    doc.floors[0].wall_ids = Object.keys(doc.walls); doc.floors[0].face_ids = ['room'];
    const dataRoot = path.join(root, 'data');
    const source = path.join(dataRoot, 'orthogonal', 'building.json');
    await fs.mkdir(path.dirname(source), { recursive: true });
    const service = new ConversionService({ projectRoot: process.cwd(), dataRoot, port: 0, development: false }, new ProjectService(dataRoot));
    const convert = async (name: string) => {
      await fs.writeFile(source, JSON.stringify(doc));
      const job = await service.submit({ projects: [{ buildingId: 'orthogonal', revision: doc.metadata.revision }], formats: ['embodied'], outputRoot: path.join(root, name), overwrite: false });
      await service.idle();
      return service.get(job.id).items[0];
    };
    expect(await convert('baseline')).toMatchObject({ status: 'succeeded' });
    doc.vertices.b.y_mm += 1; doc.metadata.revision++;
    expect(await convert('diagonal')).toMatchObject({ status: 'quarantined', message: expect.stringContaining('nonorthogonal') });
    doc.workflow.status = 'draft';
    const repair = previewOrthogonalRepair(doc, '0');
    expect(repair.ok).toBe(true);
    if (!repair.ok) throw new Error(repair.message);
    doc = prepareExportDocument(repair.document);
    doc.workflow.status = 'complete'; doc.metadata.status = 'complete'; doc.metadata.revision++;
    expect(await convert('repaired')).toMatchObject({ status: 'succeeded' });
    const report = JSON.parse(await fs.readFile(path.join(root, 'repaired', 'orthogonal', 'Embodied', 'validation_report.json'), 'utf8'));
    expect(report.roundtrip_exact).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 60_000);
