import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { validateBuildingDocumentFull } from '../../src/editor/domain/buildingValidation.ts';
import { deriveRelations } from '../../src/editor/connectivity/deriveRelations.ts';

function squareDocument() {
  const document = createEmptyBuilding('house', 'reference.png');
  document.reference_calibration = {
    calibrated: true,
    point_a_image: { x: 0, y: 0 },
    point_b_image: { x: 100, y: 0 },
    real_distance_mm: 1000,
    mm_per_image_pixel: 10,
    calibrated_at: '2026-07-28T00:00:00.000Z',
  };
  document.vertices = {
    a: { x_mm: 0, y_mm: 0 },
    b: { x_mm: 1000, y_mm: 0 },
    c: { x_mm: 1000, y_mm: 1000 },
    d: { x_mm: 0, y_mm: 1000 },
  };
  document.walls = {
    ab: wall('a', 'b'),
    bc: wall('b', 'c'),
    cd: wall('c', 'd'),
    da: wall('d', 'a'),
  };
  document.faces.room = {
    boundary_vertex_ids: ['a', 'b', 'c', 'd'],
    area_mm2: 1_000_000,
    function_code: 'living_room',
    display_name: 'Room',
    color: '#fff',
    local_name: '',
  };
  document.floors[0].wall_ids = Object.keys(document.walls);
  document.floors[0].face_ids = ['room'];
  return document;
}

function wall(start_vertex_id: string, end_vertex_id: string) {
  return {
    start_vertex_id,
    end_vertex_id,
    wall_type: 'exterior' as const,
    thickness_mm: 240,
    height_mm: 3000,
    material_type: 'brick' as const,
  };
}

describe('validateBuildingDocumentFull', () => {
  it('accepts the domain model implicit polygon closure', () => {
    const issues = validateBuildingDocumentFull(squareDocument());

    expect(issues.map((issue) => issue.code)).not.toContain('FACE_NOT_CLOSED');
  });

  it('reports broken entity references as blocking topology errors', () => {
    const document = squareDocument();
    document.walls.ab.start_vertex_id = 'missing_vertex';
    document.faces.room.boundary_vertex_ids[2] = 'missing_face_vertex';
    document.floors[0].wall_ids.push('missing_wall');

    const issues = validateBuildingDocumentFull(document);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WALL_VERTEX_MISSING',
          severity: 'error',
          entity_id: 'ab',
        }),
        expect.objectContaining({
          code: 'FACE_VERTEX_MISSING',
          severity: 'error',
          entity_id: 'room',
        }),
        expect.objectContaining({
          code: 'FLOOR_WALL_MISSING',
          severity: 'error',
          entity_id: 'floor_1',
        }),
      ]),
    );
  });

  it('reports an unsplit crossing as a blocking topology error', () => {
    const document = createEmptyBuilding('house', 'reference.png');
    document.vertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 1000, y_mm: 1000 },
      c: { x_mm: 0, y_mm: 1000 },
      d: { x_mm: 1000, y_mm: 0 },
    };
    document.walls = {
      diagonal_1: wall('a', 'b'),
      diagonal_2: wall('c', 'd'),
    };

    expect(validateBuildingDocumentFull(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WALL_INTERSECTION_INVALID',
          severity: 'error',
        }),
      ]),
    );
  });

  it('re-derives connectivity and blocks a room with no people path outside', () => {
    const document = squareDocument();

    expect(validateBuildingDocumentFull(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ROOM_NOT_ACCESSIBLE',
          severity: 'error',
          entity_id: 'room',
        }),
      ]),
    );
  });

  it('rejects relations that do not match the server-derived topology', () => {
    const document = squareDocument();
    document.wall_elements.front_door = {
      element_type: 'exterior_door',
      host_wall_id: 'ab',
      offset_from_start_mm: 100,
      width_mm: 800,
      height_mm: 2100,
      sill_height_mm: 0,
      status: 'valid',
    };
    const derived = deriveRelations(document);
    expect(derived.relations).toHaveLength(1);
    document.relations = derived.relations.map((relation) => ({
      ...relation,
      channels: { ...relation.channels, people: false },
    }));

    expect(validateBuildingDocumentFull(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RELATIONS_OUT_OF_DATE',
          severity: 'error',
        }),
      ]),
    );
  });
});
