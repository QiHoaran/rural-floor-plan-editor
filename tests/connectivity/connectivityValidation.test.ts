import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type {
  BuildingDocument,
  BuildingRelation,
} from '../../src/editor/domain/buildingTypes.ts';
import {
  applyDerivedRelations,
  validateConnectivity,
} from '../../src/editor/connectivity/connectivityValidation.ts';

function documentWithFaces(...ids: string[]): BuildingDocument {
  const document = createEmptyBuilding('house', 'reference.png');
  for (const id of ids) {
    document.faces[id] = {
      boundary_vertex_ids: [],
      area_mm2: 1,
      function_code: null,
      display_name: '',
      color: '',
      local_name: '',
    };
  }
  return document;
}

function relation(
  wall_element_id: string,
  from_face_id: string,
  to: BuildingRelation['to'],
  channels: BuildingRelation['channels'],
): BuildingRelation {
  return {
    relation_type: to.kind === 'outside' ? 'opening' : 'connection',
    wall_element_id,
    from_face_id,
    to,
    channels,
  };
}

describe('validateConnectivity', () => {
  it('reports no issues when there are no indoor faces', () => {
    expect(validateConnectivity(documentWithFaces())).toEqual([]);
  });

  it('reports deterministic, face-locatable people, air, and direct-light issues', () => {
    const document = documentWithFaces('b', 'a');

    expect(validateConnectivity(document)).toEqual([
      expect.objectContaining({
        level: 'error',
        code: 'FACE_NOT_PEOPLE_REACHABLE',
        entity: { type: 'face', id: 'a' },
      }),
      expect.objectContaining({
        level: 'warning',
        code: 'FACE_NOT_AIR_REACHABLE',
        entity: { type: 'face', id: 'a' },
      }),
      expect.objectContaining({
        level: 'warning',
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'a' },
      }),
      expect.objectContaining({
        level: 'error',
        code: 'FACE_NOT_PEOPLE_REACHABLE',
        entity: { type: 'face', id: 'b' },
      }),
      expect.objectContaining({
        level: 'warning',
        code: 'FACE_NOT_AIR_REACHABLE',
        entity: { type: 'face', id: 'b' },
      }),
      expect.objectContaining({
        level: 'warning',
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'b' },
      }),
    ]);
  });

  it('allows people and air through an interior-door chain but requires direct outside light', () => {
    const document = documentWithFaces('a', 'b', 'c');
    document.relations = [
      relation(
        'outside_door',
        'a',
        { kind: 'outside' },
        { people: true, air: true, light: true },
      ),
      relation(
        'ab',
        'a',
        { kind: 'face', face_id: 'b' },
        { people: true, air: true, light: false },
      ),
      relation(
        'bc',
        'b',
        { kind: 'face', face_id: 'c' },
        { people: true, air: true, light: false },
      ),
    ];

    expect(validateConnectivity(document)).toEqual([
      expect.objectContaining({
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'b' },
      }),
      expect.objectContaining({
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'c' },
      }),
    ]);
  });

  it('counts a window for air and direct light but not for people', () => {
    const document = documentWithFaces('room');
    document.relations = [
      relation(
        'window',
        'room',
        { kind: 'outside' },
        { people: false, air: true, light: true },
      ),
    ];

    expect(validateConnectivity(document)).toEqual([
      expect.objectContaining({
        code: 'FACE_NOT_PEOPLE_REACHABLE',
        entity: { type: 'face', id: 'room' },
      }),
    ]);
  });

  it('requires a light relation to be an opening for direct outside light', () => {
    const document = documentWithFaces('room');
    document.relations = [
      {
        ...relation(
          'malformed_connection',
          'room',
          { kind: 'outside' },
          { people: true, air: true, light: true },
        ),
        relation_type: 'connection',
      },
    ];

    expect(validateConnectivity(document)).toEqual([
      expect.objectContaining({
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'room' },
      }),
    ]);
  });

  it('does not let a stale ghost-face chain make a real face reachable', () => {
    const document = documentWithFaces('room');
    document.relations = [
      relation(
        'room_to_ghost',
        'room',
        { kind: 'face', face_id: 'ghost' },
        { people: true, air: true, light: false },
      ),
      relation(
        'ghost_to_outside',
        'ghost',
        { kind: 'outside' },
        { people: true, air: true, light: true },
      ),
    ];

    expect(validateConnectivity(document)).toEqual([
      expect.objectContaining({
        code: 'FACE_NOT_PEOPLE_REACHABLE',
        entity: { type: 'face', id: 'room' },
      }),
      expect.objectContaining({
        code: 'FACE_NOT_AIR_REACHABLE',
        entity: { type: 'face', id: 'room' },
      }),
      expect.objectContaining({
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'room' },
      }),
    ]);
  });

  it('does not treat a face literally named outside as the virtual outside node', () => {
    const document = documentWithFaces('outside');

    expect(validateConnectivity(document)).toEqual([
      expect.objectContaining({
        code: 'FACE_NOT_PEOPLE_REACHABLE',
        entity: { type: 'face', id: 'outside' },
      }),
      expect.objectContaining({
        code: 'FACE_NOT_AIR_REACHABLE',
        entity: { type: 'face', id: 'outside' },
      }),
      expect.objectContaining({
        code: 'FACE_NO_DIRECT_LIGHT',
        entity: { type: 'face', id: 'outside' },
      }),
    ]);
  });

  it('uses a supplied derivation result without deriving relations again', () => {
    const document = documentWithFaces('room');
    const supplied = {
      relations: [
        relation(
          'supplied',
          'room',
          { kind: 'outside' as const },
          { people: true, air: true, light: true },
        ),
      ],
      issues: [],
    };

    const result = applyDerivedRelations(document, supplied);

    expect(result.relations).toEqual(supplied.relations);
    expect(result.validation.issues).toEqual([]);
  });
});
