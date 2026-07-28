import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';

describe('createEmptyBuilding', () => {
  it('creates a schema v2 single-floor building in integer millimeter storage units', () => {
    const doc = createEmptyBuilding('house_0001', 'reference/original.jpg');

    expect(doc.schema_version).toBe('2.0.0');
    expect(doc.building_id).toBe('house_0001');
    expect(doc.coordinate_system).toEqual({
      type: 'local_cartesian',
      input_unit: 'm',
      storage_unit: 'mm',
      origin: 'bottom_left',
      precision_mm: 1,
    });
    expect(doc.building_defaults).toEqual({
      wall_thickness_mm: 240,
      wall_height_mm: 3000,
      snap_enabled: true,
      grid_size_mm: 100,
    });
    expect(doc.outside_regions).toEqual({});
    expect(doc.reference_image.path).toBe('reference/original.jpg');
    expect(doc.vertices).toEqual({});
    expect(doc.floors).toEqual([
      {
        floor_id: 'floor_1',
        name: '一层',
        wall_ids: [],
        face_ids: [],
      },
    ]);
  });

  it('uses a deterministic timestamp when supplied', () => {
    const now = '2026-07-27T01:00:00.000Z';
    const doc = createEmptyBuilding(
      'house_0002',
      'reference/original.png',
      300,
      now,
    );

    expect(doc.metadata).toEqual({
      created_at: now,
      updated_at: now,
      revision: 0,
      status: 'draft',
    });
    expect(doc.building_defaults.wall_thickness_mm).toBe(300);
  });
});
