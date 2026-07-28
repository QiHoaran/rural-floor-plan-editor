import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type {
  BuildingDocument,
  WallElementType,
} from '../../src/editor/domain/buildingTypes.ts';
import {
  placeWallElement,
  updateWallElement,
  WALL_ELEMENT_ERROR_MESSAGES,
} from '../../src/editor/commands/wallElementCommand.ts';

function face(boundary_vertex_ids: string[]) {
  return {
    boundary_vertex_ids,
    area_mm2: 4_000_000,
    function_code: null,
    display_name: '',
    color: '#fff',
    local_name: '',
  };
}

function documentWithExteriorAndSharedWalls(): BuildingDocument {
  const document = createEmptyBuilding('wall-elements', 'reference.png');
  document.vertices = {
    a: { x_mm: 0, y_mm: 0 },
    b: { x_mm: 2000, y_mm: 0 },
    c: { x_mm: 4000, y_mm: 0 },
    d: { x_mm: 4000, y_mm: 3000 },
    e: { x_mm: 2000, y_mm: 3000 },
    f: { x_mm: 0, y_mm: 3000 },
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
    room_a: face(['a', 'b', 'e', 'f']),
    room_b: face(['b', 'c', 'd', 'e']),
  };
  document.floors[0].wall_ids = ['exterior', 'shared'];
  document.floors[0].face_ids = ['room_a', 'room_b'];
  return document;
}

function place(
  document: BuildingDocument,
  element_type: WallElementType,
  host_wall_id: string,
  centerOffsetMm = 1500,
) {
  return placeWallElement(document, {
    element_type,
    host_wall_id,
    center_offset_mm: centerOffsetMm,
    width_mm: element_type === 'passage' ? 1000 : element_type.includes('window') ? 1200 : 900,
    height_mm: element_type.includes('window') ? 1200 : 2100,
    sill_height_mm: element_type.includes('window') ? 900 : 0,
  });
}

describe('placeWallElement', () => {
  it.each([
    ['exterior_door', 'exterior', 'opening'],
    ['exterior_window', 'exterior', 'opening'],
    ['interior_door', 'shared', 'connection'],
    ['passage', 'shared', 'connection'],
  ] as const)('places a valid %s and synchronizes its relation', (type, wall, relationType) => {
    const original = documentWithExteriorAndSharedWalls();
    const result = place(original, type, wall);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(original.wall_elements).toEqual({});
    expect(result.elementId).toBe('we_0001');
    expect(result.document.wall_elements[result.elementId]).toMatchObject({
      element_type: type,
      host_wall_id: wall,
      offset_from_start_mm: type === 'passage' ? 1000 : type === 'exterior_window' ? 900 : 1050,
      status: 'valid',
    });
    expect(result.document.relations).toContainEqual(
      expect.objectContaining({
        relation_type: relationType,
        wall_element_id: result.elementId,
      }),
    );
  });

  it.each([
    [{ width_mm: 0 }, 'INVALID_DIMENSIONS'],
    [{ center_offset_mm: 500 }, 'OUT_OF_BOUNDS'],
    [{ host_wall_id: 'missing' }, 'HOST_MISSING'],
  ] as const)('rejects invalid input with %s', (override, code) => {
    const document = documentWithExteriorAndSharedWalls();
    const before = structuredClone(document);
    const result = placeWallElement(document, {
      element_type: 'exterior_door',
      host_wall_id: 'exterior',
      center_offset_mm: 1500,
      width_mm: 900,
      height_mm: 2100,
      sill_height_mm: 0,
      ...override,
    });
    expect(result).toMatchObject({ ok: false, code });
    expect(document).toEqual(before);
  });

  it('allows touching intervals but rejects overlap', () => {
    const document = documentWithExteriorAndSharedWalls();
    const first = placeWallElement(document, {
      element_type: 'exterior_door',
      host_wall_id: 'exterior',
      center_offset_mm: 550,
      width_mm: 900,
      height_mm: 2100,
      sill_height_mm: 0,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(placeWallElement(first.document, {
      element_type: 'exterior_door',
      host_wall_id: 'exterior',
      center_offset_mm: 1450,
      width_mm: 900,
      height_mm: 2100,
      sill_height_mm: 0,
    }).ok).toBe(true);
    expect(placeWallElement(first.document, {
      element_type: 'exterior_door',
      host_wall_id: 'exterior',
      center_offset_mm: 1400,
      width_mm: 900,
      height_mm: 2100,
      sill_height_mm: 0,
    })).toMatchObject({ ok: false, code: 'OVERLAP' });
  });

  it('rejects exterior elements on shared walls and interior elements on exterior walls', () => {
    expect(place(documentWithExteriorAndSharedWalls(), 'exterior_window', 'shared'))
      .toMatchObject({ ok: false, code: 'SIDE_MISMATCH' });
    expect(place(documentWithExteriorAndSharedWalls(), 'interior_door', 'exterior'))
      .toMatchObject({ ok: false, code: 'SIDE_MISMATCH' });
  });

  it('allocates collision-free IDs beyond Number.MAX_SAFE_INTEGER', () => {
    const document = documentWithExteriorAndSharedWalls();
    document.wall_elements.we_9007199254740992 = {
      element_type: 'exterior_door',
      host_wall_id: 'exterior',
      offset_from_start_mm: 100,
      width_mm: 900,
      height_mm: 2100,
      sill_height_mm: 0,
      status: 'valid',
    };
    const result = place(document, 'exterior_window', 'exterior', 2200);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.elementId).toBe('we_9007199254740993');
  });

  it('revalidates edits without committing overlap', () => {
    const document = documentWithExteriorAndSharedWalls();
    const first = place(document, 'exterior_door', 'exterior', 700);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = place(first.document, 'exterior_window', 'exterior', 2200);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(updateWallElement(second.document, second.elementId, {
      offset_from_start_mm: 800,
    })).toMatchObject({ ok: false, code: 'OVERLAP' });
  });

  it('returns centralized Chinese user messages for every failure code', () => {
    const base = documentWithExteriorAndSharedWalls();
    const invalid = placeWallElement(base, {
      element_type: 'exterior_door', host_wall_id: 'exterior',
      center_offset_mm: 1500, width_mm: 0, height_mm: 2100, sill_height_mm: 0,
    });
    const missing = placeWallElement(base, {
      element_type: 'exterior_door', host_wall_id: 'missing',
      center_offset_mm: 1500, width_mm: 900, height_mm: 2100, sill_height_mm: 0,
    });
    const bounds = place(base, 'exterior_door', 'exterior', 400);
    const side = place(base, 'interior_door', 'exterior');
    const first = place(base, 'exterior_door', 'exterior', 700);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const overlap = place(first.document, 'exterior_window', 'exterior', 900);

    for (const result of [invalid, missing, bounds, side, overlap]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message).toBe(WALL_ELEMENT_ERROR_MESSAGES[result.code]);
      expect(result.message).toMatch(/[\u4e00-\u9fff]/);
      expect(result.message).not.toMatch(/\b(?:host|width|wall|element|overlap)\b/i);
    }
  });

  it('distinguishes missing elements from missing hosts and ambiguous regions', () => {
    const document = documentWithExteriorAndSharedWalls();
    expect(updateWallElement(document, 'missing_element', { width_mm: 1000 }))
      .toMatchObject({
        ok: false,
        code: 'ELEMENT_MISSING',
        message: WALL_ELEMENT_ERROR_MESSAGES.ELEMENT_MISSING,
      });

    document.vertices.orphan_start = { x_mm: 5000, y_mm: 0 };
    document.vertices.orphan_end = { x_mm: 5000, y_mm: 3000 };
    document.walls.orphan = {
      ...document.walls.shared,
      start_vertex_id: 'orphan_start',
      end_vertex_id: 'orphan_end',
    };
    expect(place(document, 'interior_door', 'orphan')).toMatchObject({
      ok: false,
      code: 'REGION_AMBIGUOUS',
      message: WALL_ELEMENT_ERROR_MESSAGES.REGION_AMBIGUOUS,
    });
  });
});
