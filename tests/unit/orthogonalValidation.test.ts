import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { validateBuildingDocumentFull } from '../../src/editor/domain/buildingValidation.ts';

export function diagonalDocument() {
  const doc = createEmptyBuilding('orthogonal', '');
  doc.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 4000, y_mm: 1 }, c: { x_mm: 4000, y_mm: 3000 }, d: { x_mm: 0, y_mm: 3000 } };
  doc.walls = Object.fromEntries([['ab', 'a', 'b'], ['bc', 'b', 'c'], ['cd', 'c', 'd'], ['da', 'd', 'a']].map(([id, start, end]) => [id, {
    start_vertex_id: start, end_vertex_id: end, wall_type: 'exterior' as const,
    thickness_mm: 240, height_mm: 2800, material_type: 'brick' as const,
  }]));
  doc.faces.room = { boundary_vertex_ids: ['a', 'b', 'c', 'd'], function_code: 'living_room', area_mm2: 12000000, display_name: '客厅', color: '#abc', local_name: '' };
  doc.floors[0].wall_ids = Object.keys(doc.walls);
  doc.floors[0].face_ids = ['room'];
  return doc;
}
const check = (doc: ReturnType<typeof diagonalDocument>) => validateBuildingDocumentFull(doc).filter(i => i.code.includes('NOT_AXIS_ALIGNED'));

describe('Embodied V2 orthogonality', () => {
  it('does not suppress a face warning when diagonal hosts leave a gap', () => {
    const doc = diagonalDocument(); doc.vertices.b.y_mm = 4000;
    doc.vertices.mid = { x_mm: 2000, y_mm: 2000 };
    doc.walls.ab.end_vertex_id = 'mid';
    expect(check(doc).filter(i => i.entity_type === 'face')).toHaveLength(1);
  });
  it('skips invalid coordinates and handles large integer collinearity exactly', () => {
    const doc = diagonalDocument();
    doc.vertices.a.x_mm = NaN;
    expect(check(doc)).toEqual([]);
    doc.vertices.a = { x_mm: -4000000000, y_mm: -4000000000 };
    doc.vertices.b = { x_mm: 4000000000, y_mm: 4000000000 };
    expect(check(doc).filter(i => i.entity_type === 'face')).toEqual([]);
  });
  it('reports a 1 mm diagonal once, as a nonblocking wall warning', () => {
    expect(check(diagonalDocument())).toMatchObject([{ code: 'WALL_NOT_AXIS_ALIGNED', severity: 'warning', entity_id: 'ab', message_params: { dx_mm: 4000, dy_mm: 1 } }]);
  });
  it('accepts exact axes and rejects every side of a rotated rectangle', () => {
    const doc = diagonalDocument(); doc.vertices.b.y_mm = 0;
    expect(check(doc)).toEqual([]);
    doc.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 4000, y_mm: 4000 }, c: { x_mm: 1000, y_mm: 7000 }, d: { x_mm: -3000, y_mm: 3000 } };
    expect(check(doc)).toHaveLength(4);
  });
  it('reports an uncovered room diagonal and skips malformed walls', () => {
    const doc = diagonalDocument(); delete doc.walls.ab;
    doc.walls.bad = { ...doc.walls.bc, start_vertex_id: 'missing' };
    doc.walls.zero = { ...doc.walls.bc, end_vertex_id: 'b' };
    expect(check(doc)).toMatchObject([{ code: 'FACE_EDGE_NOT_AXIS_ALIGNED', entity_id: 'room' }]);
  });
  it('does not duplicate a boundary spanning multiple collinear diagonal walls', () => {
    const doc = diagonalDocument(); doc.vertices.b.y_mm = 2;
    doc.vertices.mid = { x_mm: 2000, y_mm: 1 };
    doc.walls.second = { ...doc.walls.ab, start_vertex_id: 'mid' };
    doc.walls.ab.end_vertex_id = 'mid';
    expect(check(doc).map(i => i.code)).toEqual(['WALL_NOT_AXIS_ALIGNED', 'WALL_NOT_AXIS_ALIGNED']);
  });
});
