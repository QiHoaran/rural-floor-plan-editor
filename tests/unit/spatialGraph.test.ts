import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { generateSpatialGraph } from '../../src/editor/domain/spatialGraph.ts';

describe('generateSpatialGraph', () => {
  it('keeps a virtual outside node and every parallel exterior opening', () => {
    const document = createEmptyBuilding('house', 'reference.png');
    document.vertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 2000, y_mm: 0 },
      c: { x_mm: 2000, y_mm: 1000 },
      d: { x_mm: 0, y_mm: 1000 },
    };
    document.faces.room = {
      boundary_vertex_ids: ['a', 'b', 'c', 'd'],
      area_mm2: 2_000_000,
      function_code: 'living_room',
      display_name: 'Room',
      color: '#fff',
      local_name: '',
    };
    document.relations = ['door_1', 'door_2'].map((wallElementId) => ({
      relation_type: 'opening' as const,
      wall_element_id: wallElementId,
      from_face_id: 'room',
      to: { kind: 'outside' as const },
      channels: { people: true, air: true, light: true },
    }));

    const graph = generateSpatialGraph(document);

    expect(graph.nodes).toContainEqual({
      id: 'outside',
      type: 'outside',
      function_code: null,
      area_m2: null,
      centroid_mm: null,
    });
    expect(graph.nodes).toContainEqual({
      id: 'room',
      type: 'room',
      function_code: 'living_room',
      area_m2: 2,
      centroid_mm: [1000, 500],
    });
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.map((edge) => edge.wall_element_id)).toEqual([
      'door_1',
      'door_2',
    ]);
    expect(graph.edges.every((edge) => edge.target === 'outside')).toBe(true);
  });
});
