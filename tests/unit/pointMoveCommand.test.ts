import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import {
  deleteVertex,
  moveVertex,
} from '../../src/editor/commands/pointMoveCommand.ts';

function rectangle() {
  const document = createEmptyBuilding('move', 'reference.png');
  document.vertices = {
    a: { x_mm: 0, y_mm: 0 },
    b: { x_mm: 4000, y_mm: 0 },
    c: { x_mm: 4000, y_mm: 3000 },
    d: { x_mm: 0, y_mm: 3000 },
  };
  document.walls = {
    ab: wall('a', 'b'),
    bc: wall('b', 'c'),
    cd: wall('c', 'd'),
    da: wall('d', 'a'),
  };
  document.floors[0].wall_ids = ['ab', 'bc', 'cd', 'da'];
  document.faces.room = {
    boundary_vertex_ids: ['a', 'b', 'c', 'd'],
    area_mm2: 12_000_000,
    function_code: 'living_room',
    display_name: '堂屋',
    color: '#abc',
    local_name: '正房',
  };
  document.floors[0].face_ids = ['room'];
  return document;
}

function wall(start: string, end: string) {
  return {
    start_vertex_id: start,
    end_vertex_id: end,
    wall_type: 'exterior' as const,
    thickness_mm: 240,
    height_mm: 3000,
    material_type: 'brick' as const,
  };
}

describe('moveVertex', () => {
  it('validates coordinates without mutating the input', () => {
    const document = rectangle();
    const before = structuredClone(document);
    expect(moveVertex(document, 'missing', { x_mm: 1, y_mm: 2 })).toMatchObject({
      ok: false,
      code: 'VERTEX_MISSING',
    });
    for (const target of [
      { x_mm: Number.NaN, y_mm: 2 },
      { x_mm: Number.MAX_SAFE_INTEGER + 1, y_mm: 2 },
      { x_mm: 1.5, y_mm: 2 },
    ]) {
      const result = moveVertex(document, 'a', target);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.message).toMatch(/坐标|整数|安全/);
    }
    expect(document).toEqual(before);
  });

  it('moves a shared corner once and preserves the matched face annotation', () => {
    const document = rectangle();
    const result = moveVertex(document, 'b', { x_mm: 4500, y_mm: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vertexId).toBe('b');
    expect(result.document.vertices.b).toEqual({ x_mm: 4500, y_mm: 100 });
    expect(result.document.walls.ab.end_vertex_id).toBe('b');
    expect(result.document.walls.bc.start_vertex_id).toBe('b');
    expect(result.document.faces.room).toMatchObject({
      function_code: 'living_room',
      display_name: '堂屋',
      local_name: '正房',
    });
    expect(result.document.floors[0].face_ids).toContain('room');
    expect(document.vertices.b).toEqual({ x_mm: 4000, y_mm: 0 });
  });

  it('merges onto an existing point and returns the canonical vertex id', () => {
    const document = rectangle();
    document.vertices.target = { x_mm: 5000, y_mm: 0 };
    document.vertices.e = { x_mm: 6000, y_mm: 2000 };
    document.walls.extra = wall('target', 'e');
    document.floors[0].wall_ids.push('extra');
    const result = moveVertex(document, 'b', { x_mm: 5000, y_mm: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vertexId).toBe('b');
    expect(result.document.vertices.target).toBeUndefined();
    expect(result.document.walls.extra.start_vertex_id).toBe('b');
  });

  it('rolls back topology and wall-element failures atomically', () => {
    const overlap = rectangle();
    const beforeOverlap = structuredClone(overlap);
    const overlapResult = moveVertex(overlap, 'b', { x_mm: 0, y_mm: 3000 });
    expect(overlapResult).toMatchObject({ ok: false });
    expect(overlap).toEqual(beforeOverlap);

    const shortened = rectangle();
    shortened.wall_elements.door = {
      element_type: 'exterior_door',
      host_wall_id: 'ab',
      offset_from_start_mm: 2500,
      width_mm: 900,
      height_mm: 2100,
      sill_height_mm: 0,
      status: 'valid',
    };
    const beforeShortened = structuredClone(shortened);
    const shortenedResult = moveVertex(shortened, 'b', {
      x_mm: 3000,
      y_mm: 0,
    });
    expect(shortenedResult).toMatchObject({
      ok: false,
      code: 'ELEMENT_OUT_OF_BOUNDS',
    });
    expect(shortened).toEqual(beforeShortened);
  });

  it('keeps a courtyard marker and recomputes validation issues', () => {
    const document = rectangle();
    document.outside_regions.yard = {
      boundary_vertex_ids: ['a', 'b', 'c', 'd'],
      region_type: 'courtyard',
    };
    document.faces = {};
    document.floors[0].face_ids = [];
    const result = moveVertex(document, 'b', { x_mm: 4300, y_mm: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.outside_regions.yard.boundary_vertex_ids).toContain('b');
    expect(result.document.relations).toEqual([]);
  });
});

describe('deleteVertex', () => {
  it('deletes an orphan but refuses a connected vertex without cascading', () => {
    const document = rectangle();
    document.vertices.orphan = { x_mm: -1000, y_mm: -1000 };
    const deleted = deleteVertex(document, 'orphan');
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.document.vertices.orphan).toBeUndefined();
    const before = structuredClone(document);
    const connected = deleteVertex(document, 'a');
    expect(connected).toMatchObject({ ok: false, code: 'VERTEX_CONNECTED' });
    expect(document).toEqual(before);
  });
});
