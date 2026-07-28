import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import {
  insertWall,
  normalizeGraph,
} from '../../src/editor/topology/normalizeGraph.ts';

function hostWithElement(reverse = false) {
  const document = createEmptyBuilding('split-elements', 'reference.png');
  document.vertices = {
    a: { x_mm: 0, y_mm: 0 },
    b: { x_mm: 4000, y_mm: 0 },
  };
  document.walls.host = {
    start_vertex_id: reverse ? 'b' : 'a',
    end_vertex_id: reverse ? 'a' : 'b',
    wall_type: 'exterior',
    thickness_mm: 240,
    height_mm: 3000,
    material_type: 'brick',
  };
  document.wall_elements.element = {
    element_type: 'exterior_window',
    host_wall_id: 'host',
    offset_from_start_mm: 500,
    width_mm: 1000,
    height_mm: 1200,
    sill_height_mm: 900,
    status: 'valid',
    notes: 'preserve',
  };
  document.floors[0].wall_ids = ['host'];
  return document;
}

function crossingAt(x_mm: number) {
  return {
    start: { x_mm, y_mm: -1000 },
    end: { x_mm, y_mm: 1000 },
    wall_type: 'interior' as const,
    thickness_mm: 120,
    height_mm: 3000,
    material_type: 'brick' as const,
  };
}

describe('wall element split rehosting', () => {
  it.each([false, true])('preserves world interval and attributes when host reverse=%s', (reverse) => {
    const document = hostWithElement(reverse);
    const result = insertWall(document, crossingAt(2000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const element = result.document.wall_elements.element;
    expect(element.host_wall_id).not.toBe('host');
    expect(element).toMatchObject({
      offset_from_start_mm: 500,
      width_mm: 1000,
      height_mm: 1200,
      sill_height_mm: 900,
      notes: 'preserve',
    });
    expect(result.document.walls).not.toHaveProperty('host');
  });

  it('rejects atomically when an element spans the new split', () => {
    const document = hostWithElement();
    document.wall_elements.element.offset_from_start_mm = 1500;
    const before = structuredClone(document);
    const result = insertWall(document, crossingAt(2000));
    expect(result).toMatchObject({
      ok: false,
      code: 'ELEMENT_SPANS_SPLIT',
      conflictingWallIds: ['host'],
    });
    expect(document).toEqual(before);
  });

  it('deterministically assigns an element whose boundary equals the split', () => {
    const document = hostWithElement();
    document.wall_elements.element.offset_from_start_mm = 1000;
    const result = insertWall(document, crossingAt(2000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.wall_elements.element.offset_from_start_mm).toBe(1000);
  });

  it('clamps a tolerated one-millimeter split boundary to a valid child offset', () => {
    const document = hostWithElement();
    document.wall_elements.element.offset_from_start_mm = 1999;
    const result = insertWall(document, crossingAt(2000), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.wall_elements.element.offset_from_start_mm).toBe(0);
  });

  it.each([false, true])(
    'rehosts on a densely multi-split sloped wall without accumulated rounding drift, reverse=%s',
    (reverse) => {
      const document = createEmptyBuilding('dense-split', 'reference.png');
      document.vertices.a = { x_mm: 0, y_mm: 0 };
      document.vertices.b = { x_mm: 300, y_mm: 150 };
      document.walls.host = {
        start_vertex_id: reverse ? 'b' : 'a',
        end_vertex_id: reverse ? 'a' : 'b',
        wall_type: 'exterior',
        thickness_mm: 240,
        height_mm: 3000,
        material_type: 'brick',
      };
      document.floors[0].wall_ids.push('host');
      for (let x = 3; x < 300; x += 3) {
        const bottomId = `bottom_${x}`;
        const topId = `top_${x}`;
        const wallId = `cross_${x}`;
        document.vertices[bottomId] = { x_mm: x, y_mm: -10 };
        document.vertices[topId] = { x_mm: x, y_mm: 200 };
        document.walls[wallId] = {
          start_vertex_id: bottomId,
          end_vertex_id: topId,
          wall_type: 'interior',
          thickness_mm: 100,
          height_mm: 3000,
          material_type: 'brick',
        };
        document.floors[0].wall_ids.push(wallId);
      }
      document.wall_elements.element = {
        element_type: 'exterior_window',
        host_wall_id: 'host',
        offset_from_start_mm: 250,
        width_mm: 1,
        height_mm: 1200,
        sill_height_mm: 900,
        status: 'valid',
      };
      const originalStart = document.vertices[document.walls.host.start_vertex_id];
      const originalEnd = document.vertices[document.walls.host.end_vertex_id];
      const originalLength = Math.hypot(
        originalEnd.x_mm - originalStart.x_mm,
        originalEnd.y_mm - originalStart.y_mm,
      );
      const expected = {
        x_mm:
          originalStart.x_mm +
          ((originalEnd.x_mm - originalStart.x_mm) / originalLength) * 250,
        y_mm:
          originalStart.y_mm +
          ((originalEnd.y_mm - originalStart.y_mm) / originalLength) * 250,
      };

      const result = normalizeGraph(document, 0.1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const element = result.document.wall_elements.element;
      const child = result.document.walls[element.host_wall_id];
      const childStart = result.document.vertices[child.start_vertex_id];
      const childEnd = result.document.vertices[child.end_vertex_id];
      const childLength = Math.hypot(
        childEnd.x_mm - childStart.x_mm,
        childEnd.y_mm - childStart.y_mm,
      );
      const actual = {
        x_mm:
          childStart.x_mm +
          ((childEnd.x_mm - childStart.x_mm) / childLength) *
            element.offset_from_start_mm,
        y_mm:
          childStart.y_mm +
          ((childEnd.y_mm - childStart.y_mm) / childLength) *
            element.offset_from_start_mm,
      };
      expect(Math.hypot(actual.x_mm - expected.x_mm, actual.y_mm - expected.y_mm))
        .toBeLessThanOrEqual(1);
      expect(element.width_mm).toBe(1);
    },
  );
});
