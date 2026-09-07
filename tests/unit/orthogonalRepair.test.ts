import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { previewOrthogonalRepair } from '../../src/editor/commands/orthogonalRepair.ts';

function sample(dx = 4000, dy = 1) {
  const doc = createEmptyBuilding('repair', '');
  doc.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: dx, y_mm: dy }, c: { x_mm: dx, y_mm: 3000 } };
  const wall = { wall_type: 'exterior' as const, thickness_mm: 240, height_mm: 2800, material_type: 'brick' as const };
  doc.walls = { ab: { ...wall, start_vertex_id: 'a', end_vertex_id: 'b' }, bc: { ...wall, start_vertex_id: 'b', end_vertex_id: 'c' } };
  doc.floors[0].wall_ids = ['ab', 'bc'];
  return doc;
}
describe('orthogonal repair', () => {
  it.each([-1, 1])('rejects a topology snap moving the fixed endpoint by %s mm', (offset) => {
    const doc = sample(4000, 100);
    doc.vertices.z = doc.vertices.a;
    delete doc.vertices.a;
    doc.walls.ab.start_vertex_id = 'z';
    doc.vertices.aa = { x_mm: offset, y_mm: 0 };
    expect(previewOrthogonalRepair(doc, 'ab')).toMatchObject({ ok: false, code: 'ALIGNMENT_CONFLICT' });
  });
  it('rejects a repair creating an overlapping wall', () => {
    const doc = sample(4000, 1000);
    doc.vertices.d = { x_mm: 4000, y_mm: 0 };
    doc.walls.ad = { ...doc.walls.ab, end_vertex_id: 'd' };
    expect(previewOrthogonalRepair(doc, 'ab')).toMatchObject({ ok: false, code: 'DUPLICATE_EDGE' });
  });
  it('refuses a topology snap that would leave the repaired wall diagonal', () => {
    const doc = sample(4000, 100);
    doc.vertices.aa = { x_mm: 4000, y_mm: 1 };
    expect(previewOrthogonalRepair(doc, 'ab')).toMatchObject({ ok: false, code: 'ALIGNMENT_CONFLICT' });
  });
  it('previews the minimum displacement without mutating the source, including incident walls', () => {
    const doc = sample();
    const result = previewOrthogonalRepair(doc, 'ab');
    expect(result).toMatchObject({ ok: true, axis: 'horizontal', fixedEnd: 'start', distanceMm: 1, target: { x_mm: 4000, y_mm: 0 } });
    if (!result.ok) return;
    expect(result.document.vertices.b).toEqual({ x_mm: 4000, y_mm: 0 });
    expect(result.affectedWallIds).toEqual(['ab', 'bc']);
    expect(doc.vertices.b.y_mm).toBe(1);
  });
  it('allows changing axis and fixed endpoint, with horizontal tie breaking', () => {
    expect(previewOrthogonalRepair(sample(1000, 1000), 'ab')).toMatchObject({ ok: true, axis: 'horizontal' });
    expect(previewOrthogonalRepair(sample(1, 4000), 'ab')).toMatchObject({ ok: true, axis: 'vertical', target: { x_mm: 0, y_mm: 4000 } });
    expect(previewOrthogonalRepair(sample(4000, 1000), 'ab', 'end', 'vertical')).toMatchObject({ ok: true, target: { x_mm: 4000, y_mm: 0 }, vertexId: 'a', distanceMm: 4000 });
  });
  it('rejects zero length, missing walls, read-only documents and invalid hosts', () => {
    expect(previewOrthogonalRepair(sample(4000, 0), 'ab', 'start', 'vertical')).toMatchObject({ ok: false, code: 'ZERO_LENGTH' });
    expect(previewOrthogonalRepair(sample(), 'missing')).toMatchObject({ ok: false });
    const doc = sample(); doc.workflow.status = 'complete';
    expect(previewOrthogonalRepair(doc, 'ab')).toMatchObject({ ok: false, code: 'READ_ONLY' });
    doc.workflow.status = 'draft';
    doc.vertices.b.y_mm = 1000;
    doc.wall_elements.door = { host_wall_id: 'ab', element_type: 'door', offset_from_start_mm: 2000, width_mm: 900, height_mm: 2100, sill_height_mm: 0, status: 'valid' };
    expect(previewOrthogonalRepair(doc, 'ab', 'start', 'vertical')).toMatchObject({ ok: false, code: 'ELEMENT_OUT_OF_BOUNDS' });
  });
});
