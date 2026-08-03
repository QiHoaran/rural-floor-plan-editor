import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { exportBuildingToGeoJson } from '../../src/editor/domain/buildingGeoJson.ts';

describe('exportBuildingToGeoJson', () => {
  it('closes polygon rings explicitly', () => {
    const document = createEmptyBuilding('house', 'reference.png');
    document.vertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 1000, y_mm: 0 },
      c: { x_mm: 0, y_mm: 1000 },
    };
    document.faces.room = {
      boundary_vertex_ids: ['a', 'b', 'c'],
      area_mm2: 500_000,
      function_code: 'bedroom',
      display_name: 'Room',
      color: '#fff',
      local_name: '',
    };

    const geoJson = exportBuildingToGeoJson(document);
    const polygon = geoJson.features.find(
      (feature) => feature.properties.entity_id === 'room',
    );

    expect(polygon?.geometry.coordinates).toEqual([
      [
        [0, 0],
        [1000, 0],
        [0, 1000],
        [0, 0],
      ],
    ]);
  });

  it('rejects a polygon with a missing vertex instead of inventing [0, 0]', () => {
    const document = createEmptyBuilding('house', 'reference.png');
    document.vertices = {
      a: { x_mm: 100, y_mm: 100 },
      b: { x_mm: 1000, y_mm: 100 },
    };
    document.faces.room = {
      boundary_vertex_ids: ['a', 'b', 'missing'],
      area_mm2: 500_000,
      function_code: 'bedroom',
      display_name: 'Room',
      color: '#fff',
      local_name: '',
    };

    expect(() => exportBuildingToGeoJson(document)).toThrow(
      'faces.room.boundary_vertex_ids',
    );
  });
});
