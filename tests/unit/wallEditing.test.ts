import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { updateWallLength } from '../../src/editor/domain/wallEditing.ts';

function documentWithWall() {
  const document = createEmptyBuilding(
    'house_0001',
    'reference/original.png',
  );
  document.vertices = {
    v_1: { x_mm: 1000, y_mm: 1000 },
    v_2: { x_mm: 5500, y_mm: 1000 },
  };
  document.walls = {
    w_1: {
      start_vertex_id: 'v_1',
      end_vertex_id: 'v_2',
      wall_type: 'exterior',
      thickness_mm: 370,
      height_mm: 3000,
      material_type: 'brick',
    },
  };
  document.floors[0].wall_ids = ['w_1'];
  return document;
}

describe('updateWallLength', () => {
  it('fixes the start vertex and moves the end vertex', () => {
    const updated = updateWallLength(documentWithWall(), 'w_1', 5200, 'start');

    expect(updated.vertices.v_1).toEqual({ x_mm: 1000, y_mm: 1000 });
    expect(updated.vertices.v_2).toEqual({ x_mm: 6200, y_mm: 1000 });
  });

  it('fixes the end vertex and moves the start vertex', () => {
    const updated = updateWallLength(documentWithWall(), 'w_1', 4000, 'end');

    expect(updated.vertices.v_1).toEqual({ x_mm: 1500, y_mm: 1000 });
    expect(updated.vertices.v_2).toEqual({ x_mm: 5500, y_mm: 1000 });
  });

  it('rejects invalid walls and lengths', () => {
    expect(() =>
      updateWallLength(documentWithWall(), 'w_1', 50, 'start'),
    ).toThrow('0.10 m');
    expect(() =>
      updateWallLength(documentWithWall(), 'missing', 5000, 'start'),
    ).toThrow('不存在');
  });

  it('rejects unsafe millimeter lengths before writing vertices', () => {
    expect(() =>
      updateWallLength(
        documentWithWall(),
        'w_1',
        Number.POSITIVE_INFINITY,
        'start',
      ),
    ).toThrow('安全整数');
    expect(() =>
      updateWallLength(
        documentWithWall(),
        'w_1',
        Number.MAX_SAFE_INTEGER + 1,
        'start',
      ),
    ).toThrow('安全整数');
  });
});
