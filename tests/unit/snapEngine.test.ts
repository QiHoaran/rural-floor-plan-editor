import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type { BuildingDocument } from '../../src/editor/domain/buildingTypes.ts';
import {
  createSnapIndex,
  findSnap,
  snapTypedEndpoint,
} from '../../src/editor/cad/snapEngine.ts';

function documentWithWalls(): BuildingDocument {
  const document = createEmptyBuilding('house_0001', 'reference.png');
  document.vertices = {
    v_left: { x_mm: 0, y_mm: 0 },
    v_right: { x_mm: 1000, y_mm: 0 },
    v_bottom: { x_mm: 500, y_mm: -500 },
    v_top: { x_mm: 500, y_mm: 500 },
  };
  document.walls = {
    w_horizontal: {
      start_vertex_id: 'v_left',
      end_vertex_id: 'v_right',
      wall_type: 'exterior',
      thickness_mm: 240,
      height_mm: 3000,
      material_type: 'brick',
    },
    w_vertical: {
      start_vertex_id: 'v_bottom',
      end_vertex_id: 'v_top',
      wall_type: 'interior',
      thickness_mm: 240,
      height_mm: 3000,
      material_type: 'brick',
    },
  };
  document.floors[0].wall_ids = ['w_horizontal', 'w_vertical'];
  return document;
}

describe('findSnap', () => {
  it('uses strict vertex over intersection over projection over grid priority', () => {
    const document = documentWithWalls();
    document.vertices.v_priority = { x_mm: 510, y_mm: 10 };

    expect(
      findSnap(createSnapIndex(document), { x_mm: 502, y_mm: 2 }, 1, 'geometry'),
    ).toEqual({
      kind: 'vertex',
      point: { x_mm: 510, y_mm: 10 },
      vertexId: 'v_priority',
    });

    delete document.vertices.v_priority;
    expect(
      findSnap(createSnapIndex(document), { x_mm: 502, y_mm: 2 }, 1, 'geometry'),
    ).toEqual({
      kind: 'intersection',
      point: { x_mm: 500, y_mm: 0 },
      wallIds: ['w_horizontal', 'w_vertical'],
    });

    delete document.walls.w_vertical;
    expect(
      findSnap(createSnapIndex(document), { x_mm: 502, y_mm: 2 }, 1, 'geometry'),
    ).toEqual({
      kind: 'wall_projection',
      point: { x_mm: 502, y_mm: 0 },
      wallId: 'w_horizontal',
    });

    delete document.walls.w_horizontal;
    expect(
      findSnap(createSnapIndex(document), { x_mm: 502, y_mm: 2 }, 1, 'geometry'),
    ).toEqual({
      kind: 'grid',
      point: { x_mm: 500, y_mm: 0 },
    });
  });

  it('keeps the radius at twelve screen pixels across zoom levels', () => {
    const document = createEmptyBuilding('house_0001', 'reference.png');
    document.vertices.v_1 = { x_mm: 0, y_mm: 0 };

    expect(
      findSnap(createSnapIndex(document), { x_mm: 120, y_mm: 0 }, 0.1, 'geometry'),
    ).toMatchObject({ kind: 'vertex', vertexId: 'v_1' });
    expect(
      findSnap(createSnapIndex(document), { x_mm: 60, y_mm: 0 }, 0.2, 'geometry'),
    ).toMatchObject({ kind: 'vertex', vertexId: 'v_1' });
  });

  it('returns none when every candidate is outside the screen radius', () => {
    const document = createEmptyBuilding('house_0001', 'reference.png');
    document.vertices.v_1 = { x_mm: 0, y_mm: 0 };
    document.building_defaults.grid_size_mm = 1000;

    expect(
      findSnap(createSnapIndex(document), { x_mm: 121, y_mm: 149 }, 0.1, 'geometry'),
    ).toEqual({ kind: 'none' });
  });

  it('uses the document grid size and defaults it to 100 mm', () => {
    const document = createEmptyBuilding('house_0001', 'reference.png');
    document.building_defaults.grid_size_mm = 250;
    expect(
      findSnap(createSnapIndex(document), { x_mm: 241, y_mm: 257 }, 1, 'grid'),
    ).toEqual({
      kind: 'grid',
      point: { x_mm: 250, y_mm: 250 },
    });

    document.building_defaults.grid_size_mm = 0;
    expect(
      findSnap(createSnapIndex(document), { x_mm: 96, y_mm: 103 }, 1, 'grid'),
    ).toEqual({
      kind: 'grid',
      point: { x_mm: 100, y_mm: 100 },
    });
  });

  it('returns none when document snapping or store snapping is off', () => {
    const document = documentWithWalls();
    expect(
      findSnap(createSnapIndex(document), { x_mm: 0, y_mm: 0 }, 1, 'none'),
    ).toEqual({ kind: 'none' });

    document.building_defaults.snap_enabled = false;
    expect(
      findSnap(createSnapIndex(document), { x_mm: 0, y_mm: 0 }, 1, 'geometry'),
    ).toEqual({ kind: 'none' });
  });

  it('queries a stable precomputed index without rebuilding intersections', () => {
    const document = documentWithWalls();
    const index = createSnapIndex(document);
    document.walls = {};
    document.vertices = {};

    expect(
      findSnap(index, { x_mm: 502, y_mm: 2 }, 1, 'geometry'),
    ).toMatchObject({
      kind: 'intersection',
      point: { x_mm: 500, y_mm: 0 },
    });
    expect(
      findSnap(index, { x_mm: 498, y_mm: -2 }, 1, 'geometry'),
    ).toMatchObject({
      kind: 'intersection',
      point: { x_mm: 500, y_mm: 0 },
    });
  });

  it('handles many indexed walls without query-time pair enumeration', () => {
    const document = createEmptyBuilding('house_0001', 'reference.png');
    for (let index = 0; index < 24; index += 1) {
      document.vertices[`v_l_${index}`] = {
        x_mm: -1000,
        y_mm: index * 100,
      };
      document.vertices[`v_r_${index}`] = {
        x_mm: 1000,
        y_mm: index * 100,
      };
      document.walls[`w_h_${index}`] = {
        start_vertex_id: `v_l_${index}`,
        end_vertex_id: `v_r_${index}`,
        wall_type: 'interior',
        thickness_mm: 100,
        height_mm: 3000,
        material_type: 'brick',
      };
    }
    document.vertices.v_bottom = { x_mm: 0, y_mm: -1000 };
    document.vertices.v_top = { x_mm: 0, y_mm: 4000 };
    document.walls.w_vertical = {
      start_vertex_id: 'v_bottom',
      end_vertex_id: 'v_top',
      wall_type: 'interior',
      thickness_mm: 100,
      height_mm: 3000,
      material_type: 'brick',
    };

    const index = createSnapIndex(document);
    expect(index.intersections).toHaveLength(24);
    expect(
      findSnap(index, { x_mm: 3, y_mm: 1702 }, 1, 'geometry'),
    ).toMatchObject({
      kind: 'intersection',
      point: { x_mm: 0, y_mm: 1700 },
    });
  });
});

describe('snapTypedEndpoint', () => {
  it('preserves an exact 4500 mm endpoint when a vertex is 3 mm away', () => {
    const document = createEmptyBuilding('house_0001', 'reference.png');
    document.vertices.v_4503 = { x_mm: 4503, y_mm: 0 };

    expect(
      snapTypedEndpoint(document, { x_mm: 4500, y_mm: 0 }),
    ).toEqual({ point: { x_mm: 4500, y_mm: 0 } });
  });

  it('reuses a vertex exactly 1 mm from a typed endpoint', () => {
    const document = createEmptyBuilding('house_0001', 'reference.png');
    document.vertices.v_4501 = { x_mm: 4501, y_mm: 0 };

    expect(
      snapTypedEndpoint(document, { x_mm: 4500, y_mm: 0 }),
    ).toEqual({
      point: { x_mm: 4501, y_mm: 0 },
      vertexId: 'v_4501',
    });
  });
});
