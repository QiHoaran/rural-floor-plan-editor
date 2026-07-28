import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type {
  BuildingDocument,
  WallElementType,
} from '../../src/editor/domain/buildingTypes.ts';
import {
  deriveRelations,
} from '../../src/editor/connectivity/deriveRelations.ts';
import {
  applyDerivedRelations,
} from '../../src/editor/connectivity/connectivityValidation.ts';

function face(boundary_vertex_ids: string[]) {
  return {
    boundary_vertex_ids,
    area_mm2: 1_000_000,
    function_code: null,
    display_name: '',
    color: '#fff',
    local_name: '',
  };
}

function addElement(
  document: BuildingDocument,
  id: string,
  element_type: WallElementType,
  host_wall_id: string,
) {
  document.wall_elements[id] = {
    element_type,
    host_wall_id,
    offset_from_start_mm: 100,
    width_mm: 800,
    height_mm: 2100,
    sill_height_mm: 0,
    status: 'valid',
  };
}

function adjacentRooms(): BuildingDocument {
  const document = createEmptyBuilding('house', 'reference.png');
  document.vertices = {
    a: { x_mm: 0, y_mm: 0 },
    b: { x_mm: 1000, y_mm: 0 },
    c: { x_mm: 2000, y_mm: 0 },
    d: { x_mm: 2000, y_mm: 1000 },
    e: { x_mm: 1000, y_mm: 1000 },
    f: { x_mm: 0, y_mm: 1000 },
  };
  document.walls = {
    exterior: {
      start_vertex_id: 'a',
      end_vertex_id: 'f',
      wall_type: 'exterior',
      thickness_mm: 240,
      height_mm: 3000,
      material_type: 'brick',
    },
    shared: {
      start_vertex_id: 'b',
      end_vertex_id: 'e',
      wall_type: 'interior',
      thickness_mm: 120,
      height_mm: 3000,
      material_type: 'brick',
    },
  };
  document.faces = {
    room_b: face(['b', 'c', 'd', 'e']),
    room_a: face(['a', 'b', 'e', 'f']),
  };
  document.floors[0].face_ids = ['room_b', 'room_a'];
  return document;
}

describe('deriveRelations', () => {
  it('derives opening and connection channels from element type and wall sides', () => {
    const document = adjacentRooms();
    addElement(document, 'z_window', 'exterior_window', 'exterior');
    addElement(document, 'a_door', 'exterior_door', 'exterior');
    addElement(document, 'm_inside', 'interior_door', 'shared');
    addElement(document, 'n_passage', 'passage', 'shared');

    expect(deriveRelations(document)).toEqual({
      relations: [
        {
          relation_type: 'opening',
          wall_element_id: 'a_door',
          from_face_id: 'room_a',
          to: { kind: 'outside' },
          channels: { people: true, air: true, light: true },
        },
        {
          relation_type: 'connection',
          wall_element_id: 'm_inside',
          from_face_id: 'room_a',
          to: { kind: 'face', face_id: 'room_b' },
          channels: { people: true, air: true, light: false },
        },
        {
          relation_type: 'connection',
          wall_element_id: 'n_passage',
          from_face_id: 'room_a',
          to: { kind: 'face', face_id: 'room_b' },
          channels: { people: true, air: true, light: false },
        },
        {
          relation_type: 'opening',
          wall_element_id: 'z_window',
          from_face_id: 'room_a',
          to: { kind: 'outside' },
          channels: { people: false, air: true, light: true },
        },
      ],
      issues: [],
    });
  });

  it('preserves parallel windows and doors as separate deterministic relations', () => {
    const document = adjacentRooms();
    addElement(document, 'window_2', 'exterior_window', 'exterior');
    addElement(document, 'window_1', 'exterior_window', 'exterior');
    addElement(document, 'door_2', 'interior_door', 'shared');
    addElement(document, 'door_1', 'interior_door', 'shared');
    const before = structuredClone(document);

    const result = deriveRelations(document);

    expect(result.relations.map((relation) => relation.wall_element_id)).toEqual([
      'door_1',
      'door_2',
      'window_1',
      'window_2',
    ]);
    expect(result.relations).toHaveLength(4);
    expect(document).toEqual(before);
  });

  it('maps a courtyard boundary to the single outside node', () => {
    const document = adjacentRooms();
    document.faces = { room_a: document.faces.room_a };
    document.outside_regions.courtyard = {
      boundary_vertex_ids: ['b', 'c', 'd', 'e'],
      region_type: 'courtyard',
    };
    addElement(document, 'courtyard_window', 'exterior_window', 'shared');

    expect(deriveRelations(document)).toEqual({
      relations: [
        expect.objectContaining({
          wall_element_id: 'courtyard_window',
          from_face_id: 'room_a',
          to: { kind: 'outside' },
        }),
      ],
      issues: [],
    });
  });

  it('recognizes a host wall through a collinear split chain at large coordinates', () => {
    const document = adjacentRooms();
    const base = 8_000_000_000_000_000;
    document.vertices.b = { x_mm: base, y_mm: base };
    document.vertices.e = { x_mm: base, y_mm: base + 1000 };
    document.vertices.mid = { x_mm: base, y_mm: base + 500 };
    document.vertices.a = { x_mm: base - 1000, y_mm: base };
    document.vertices.f = { x_mm: base - 1000, y_mm: base + 1000 };
    document.vertices.c = { x_mm: base + 1000, y_mm: base };
    document.vertices.d = { x_mm: base + 1000, y_mm: base + 1000 };
    document.faces.room_a.boundary_vertex_ids = ['a', 'b', 'mid', 'e', 'f'];
    document.faces.room_b.boundary_vertex_ids = ['b', 'c', 'd', 'e', 'mid'];
    addElement(document, 'inside', 'interior_door', 'shared');

    expect(deriveRelations(document).issues).toEqual([]);
    expect(deriveRelations(document).relations[0]).toEqual(
      expect.objectContaining({
        from_face_id: 'room_a',
        to: { kind: 'face', face_id: 'room_b' },
      }),
    );
  });

  it('returns locatable deterministic issues for missing, mismatched, and ambiguous hosts', () => {
    const document = adjacentRooms();
    addElement(document, 'missing', 'interior_door', 'not_there');
    addElement(document, 'outside_on_shared', 'exterior_door', 'shared');
    addElement(document, 'inside_on_exterior', 'interior_door', 'exterior');
    document.walls.orphan = {
      ...document.walls.shared,
      start_vertex_id: 'a',
      end_vertex_id: 'd',
    };
    addElement(document, 'ambiguous', 'interior_door', 'orphan');

    const result = deriveRelations(document);

    expect(result.relations).toEqual([]);
    expect(result.issues.map(({ code, entity }) => ({ code, entity }))).toEqual([
      {
        code: 'ELEMENT_REGION_AMBIGUOUS',
        entity: { type: 'wall_element', id: 'ambiguous' },
      },
      {
        code: 'ELEMENT_SIDE_MISMATCH',
        entity: { type: 'wall_element', id: 'inside_on_exterior' },
      },
      {
        code: 'ELEMENT_HOST_WALL_MISSING',
        entity: { type: 'wall_element', id: 'missing' },
      },
      {
        code: 'ELEMENT_SIDE_MISMATCH',
        entity: { type: 'wall_element', id: 'outside_on_shared' },
      },
    ]);
  });

  it('treats missing boundary vertices and two outside sides as ambiguous without throwing', () => {
    const missingVertex = adjacentRooms();
    missingVertex.faces.room_a.boundary_vertex_ids = ['a', 'missing', 'e', 'f'];
    addElement(missingVertex, 'broken', 'exterior_door', 'exterior');

    const twoOutside = adjacentRooms();
    twoOutside.faces = {};
    twoOutside.outside_regions = {
      left: {
        boundary_vertex_ids: ['a', 'b', 'e', 'f'],
        region_type: 'courtyard',
      },
      right: {
        boundary_vertex_ids: ['b', 'c', 'd', 'e'],
        region_type: 'courtyard',
      },
    };
    addElement(twoOutside, 'between_yards', 'exterior_door', 'shared');

    expect(deriveRelations(missingVertex).issues[0]).toEqual(
      expect.objectContaining({ code: 'ELEMENT_REGION_AMBIGUOUS' }),
    );
    expect(deriveRelations(twoOutside).issues[0]).toEqual(
      expect.objectContaining({ code: 'ELEMENT_REGION_AMBIGUOUS' }),
    );
  });

  it('ignores an unrelated malformed boundary while retaining a valid opening', () => {
    const document = adjacentRooms();
    document.outside_regions.remote_bad = {
      boundary_vertex_ids: ['x', 'x', 'x'],
      region_type: 'courtyard',
    };
    addElement(document, 'outside', 'exterior_door', 'exterior');

    expect(deriveRelations(document)).toEqual({
      relations: [
        expect.objectContaining({
          wall_element_id: 'outside',
          from_face_id: 'room_a',
          to: { kind: 'outside' },
        }),
      ],
      issues: [],
    });
  });

  it('reports ambiguity when a malformed boundary references the host endpoints', () => {
    const document = adjacentRooms();
    document.outside_regions.broken_near_host = {
      boundary_vertex_ids: ['a', 'missing', 'f'],
      region_type: 'courtyard',
    };
    addElement(document, 'outside', 'exterior_door', 'exterior');

    expect(deriveRelations(document)).toEqual({
      relations: [],
      issues: [
        expect.objectContaining({
          code: 'ELEMENT_REGION_AMBIGUOUS',
          entity: { type: 'wall_element', id: 'outside' },
        }),
      ],
    });
  });

  it('reports ambiguity when a degenerate edge crosses the full host wall', () => {
    const document = adjacentRooms();
    document.vertices.below = { x_mm: 0, y_mm: -1000 };
    document.vertices.above = { x_mm: 0, y_mm: 2000 };
    document.outside_regions.crossing_bad = {
      boundary_vertex_ids: ['below', 'above', 'below'],
      region_type: 'courtyard',
    };
    addElement(document, 'outside', 'exterior_door', 'exterior');

    expect(deriveRelations(document)).toEqual({
      relations: [],
      issues: [
        expect.objectContaining({
          code: 'ELEMENT_REGION_AMBIGUOUS',
          entity: { type: 'wall_element', id: 'outside' },
        }),
      ],
    });
  });

  it('ignores a malformed boundary that only touches one host endpoint', () => {
    const document = adjacentRooms();
    document.vertices.remote = { x_mm: 5000, y_mm: 5000 };
    document.outside_regions.touching_bad = {
      boundary_vertex_ids: ['a', 'remote', 'missing'],
      region_type: 'courtyard',
    };
    addElement(document, 'outside', 'exterior_door', 'exterior');

    expect(deriveRelations(document)).toEqual({
      relations: [
        expect.objectContaining({
          wall_element_id: 'outside',
          from_face_id: 'room_a',
          to: { kind: 'outside' },
        }),
      ],
      issues: [],
    });
  });
});

describe('applyDerivedRelations', () => {
  it('replaces stale relations and owned issues while preserving unrelated issues immutably', () => {
    const document = adjacentRooms();
    addElement(document, 'outside', 'exterior_door', 'exterior');
    document.relations = [
      {
        relation_type: 'connection',
        wall_element_id: 'stale',
        from_face_id: 'missing_a',
        to: { kind: 'face', face_id: 'missing_b' },
        channels: { people: false, air: false, light: false },
      },
    ];
    document.validation.issues = [
      {
        id: 'element_region_ambiguous:stale',
        level: 'error',
        code: 'ELEMENT_REGION_AMBIGUOUS',
        message: 'stale',
      },
      {
        id: 'face_not_people_reachable:stale',
        level: 'error',
        code: 'FACE_NOT_PEOPLE_REACHABLE',
        message: 'stale',
      },
      {
        id: 'keep',
        level: 'warning',
        code: 'OTHER',
        message: 'keep',
      },
    ];
    const before = structuredClone(document);

    const result = applyDerivedRelations(document);

    expect(result).not.toBe(document);
    expect(result.relations.map((relation) => relation.wall_element_id)).toEqual([
      'outside',
    ]);
    expect(result.validation.issues).toEqual([
      expect.objectContaining({ id: 'keep' }),
      expect.objectContaining({
        code: 'FACE_NOT_PEOPLE_REACHABLE',
        entity: { type: 'face', id: 'room_b' },
      }),
      expect.objectContaining({
        code: 'FACE_NOT_AIR_REACHABLE',
        entity: { type: 'face', id: 'room_b' },
      }),
      expect.objectContaining({
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'room_b' },
      }),
    ]);
    expect(document).toEqual(before);
  });
});
