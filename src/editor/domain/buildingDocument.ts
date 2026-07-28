import type { BuildingDocument } from './buildingTypes.ts';

export function createEmptyBuilding(
  buildingId: string,
  referencePath: string,
  wallThicknessMm = 240,
  now = new Date().toISOString(),
): BuildingDocument {
  return {
    schema_version: '2.0.0',
    building_id: buildingId,
    coordinate_system: {
      type: 'local_cartesian',
      input_unit: 'm',
      storage_unit: 'mm',
      origin: 'bottom_left',
      precision_mm: 1,
    },
    building_defaults: {
      wall_thickness_mm: wallThicknessMm,
      wall_height_mm: 3000,
      snap_enabled: true,
      grid_size_mm: 100,
    },
    reference_image: {
      path: referencePath,
      mime_type: 'application/octet-stream',
      width_px: 0,
      height_px: 0,
      opacity: 0.55,
      transform: {
        translate_x_mm: 0,
        translate_y_mm: 0,
        scale: 1,
        rotation_deg: 0,
      },
    },
    floors: [
      {
        floor_id: 'floor_1',
        name: '一层',
        wall_ids: [],
        face_ids: [],
      },
    ],
    vertices: {},
    walls: {},
    wall_elements: {},
    faces: {},
    outside_regions: {},
    relations: [],
    custom_function_types: [],
    validation: {
      issues: [],
    },
    metadata: {
      created_at: now,
      updated_at: now,
      revision: 0,
      status: 'draft',
    },
  };
}
