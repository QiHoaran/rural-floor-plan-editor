import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type {
  BuildingDocument,
  BuildingFace,
  BuildingVertex,
  BuildingWall,
} from '../../src/editor/domain/buildingTypes.ts';
import { deriveFaces } from '../../src/editor/topology/faceTraversal.ts';
import {
  applyDerivedFaces,
  matchFaces,
} from '../../src/editor/topology/faceMatching.ts';

const WALL: Omit<BuildingWall, 'start_vertex_id' | 'end_vertex_id'> = {
  wall_type: 'interior',
  thickness_mm: 120,
  height_mm: 2800,
  material_type: 'brick',
};

function graph(
  vertices: Record<string, BuildingVertex>,
  edges: Array<[string, string, string]>,
): Pick<BuildingDocument, 'vertices' | 'walls'> {
  return {
    vertices,
    walls: Object.fromEntries(
      edges.map(([id, start_vertex_id, end_vertex_id]) => [
        id,
        { start_vertex_id, end_vertex_id, ...WALL },
      ]),
    ),
  };
}

function rectangle(
  x1 = 0,
  y1 = 0,
  x2 = 4000,
  y2 = 3000,
  prefix = 'v',
) {
  const vertices = {
    [`${prefix}1`]: { x_mm: x1, y_mm: y1 },
    [`${prefix}2`]: { x_mm: x2, y_mm: y1 },
    [`${prefix}3`]: { x_mm: x2, y_mm: y2 },
    [`${prefix}4`]: { x_mm: x1, y_mm: y2 },
  };
  return graph(vertices, [
    ['w1', `${prefix}1`, `${prefix}2`],
    ['w2', `${prefix}2`, `${prefix}3`],
    ['w3', `${prefix}3`, `${prefix}4`],
    ['w4', `${prefix}4`, `${prefix}1`],
  ]);
}

function bedroom(boundary_vertex_ids: string[], area_mm2 = 12_000_000): BuildingFace {
  return {
    boundary_vertex_ids,
    area_mm2,
    function_code: 'bedroom',
    display_name: 'Bedroom',
    color: '#112233',
    local_name: 'East room',
    notes: 'Keep this annotation',
  };
}

function colorOnly(
  boundary_vertex_ids: string[],
  area_mm2 = 12_000_000,
): BuildingFace {
  return {
    boundary_vertex_ids,
    area_mm2,
    function_code: null,
    display_name: '',
    color: '#abcdef',
    local_name: '',
  };
}

describe('matchFaces', () => {
  it('keeps the old ID and all function metadata after a boundary wall is split', () => {
    const oldGraph = rectangle();
    const splitGraph = graph(
      {
        ...oldGraph.vertices,
        vm: { x_mm: 2000, y_mm: 0 },
      },
      [
        ['w1a', 'v1', 'vm'],
        ['w1b', 'vm', 'v2'],
        ['w2', 'v2', 'v3'],
        ['w3', 'v3', 'v4'],
        ['w4', 'v4', 'v1'],
      ],
    );

    const result = matchFaces(
      { face_old: bedroom(['v1', 'v2', 'v3', 'v4']) },
      deriveFaces(splitGraph),
      splitGraph.vertices,
      oldGraph.vertices,
    );

    expect(result.warnings).toEqual([]);
    expect(result.faces.face_old).toEqual({
      ...bedroom(['v1', 'v2', 'v3', 'v4']),
      boundary_vertex_ids: ['v1', 'vm', 'v2', 'v3', 'v4'],
    });
  });

  it('uniquely fuzzy-matches a face after one point moves slightly', () => {
    const oldGraph = rectangle();
    const moved = rectangle(0, 0, 4100, 3000);

    const result = matchFaces(
      { face_old: bedroom(['v1', 'v2', 'v3', 'v4']) },
      deriveFaces(moved),
      moved.vertices,
      oldGraph.vertices,
    );

    expect(Object.keys(result.faces)).toEqual(['face_old']);
    expect(result.faces.face_old.function_code).toBe('bedroom');
    expect(result.faces.face_old.area_mm2).toBe(12_300_000);
    expect(result.warnings).toEqual([]);
  });

  it('rejects equal-area equal-centroid faces whose true IoU is about one percent', () => {
    const oldGraph = rectangle(-5000, -100, 5000, 100, 'o');
    const rotated = rectangle(-100, -5000, 100, 5000, 'n');

    const result = matchFaces(
      { face_old: bedroom(['o1', 'o2', 'o3', 'o4'], 2_000_000) },
      deriveFaces(rotated),
      rotated.vertices,
      oldGraph.vertices,
    );

    expect(result.faces).not.toHaveProperty('face_old');
    expect(Object.values(result.faces)[0].function_code).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'FACE_ANNOTATION_REVIEW',
      entity: { type: 'face', id: 'face_old' },
    });
  });

  it('fuzzy-matches a slightly edited concave face with high overlap', () => {
    const oldVertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 4000, y_mm: 0 },
      c: { x_mm: 4000, y_mm: 1000 },
      d: { x_mm: 1000, y_mm: 1000 },
      e: { x_mm: 1000, y_mm: 4000 },
      f: { x_mm: 0, y_mm: 4000 },
    };
    const movedVertices = {
      ...oldVertices,
      b: { x_mm: 4100, y_mm: 0 },
      c: { x_mm: 4100, y_mm: 1000 },
    };
    const edges: Array<[string, string, string]> = [
      ['w1', 'a', 'b'],
      ['w2', 'b', 'c'],
      ['w3', 'c', 'd'],
      ['w4', 'd', 'e'],
      ['w5', 'e', 'f'],
      ['w6', 'f', 'a'],
    ];

    const result = matchFaces(
      { face_old: bedroom(['a', 'b', 'c', 'd', 'e', 'f'], 7_000_000) },
      deriveFaces(graph(movedVertices, edges)),
      movedVertices,
      oldVertices,
    );

    expect(Object.keys(result.faces)).toEqual(['face_old']);
    expect(result.faces.face_old.function_code).toBe('bedroom');
    expect(result.faces.face_old.area_mm2).toBe(7_100_000);
  });

  it('keeps fuzzy matching metrics finite at large safe-integer coordinates', () => {
    const origin = 9_000_000_000_000_000;
    const oldGraph = rectangle(origin, origin, origin + 1000, origin + 1000);
    const moved = rectangle(origin, origin, origin + 1001, origin + 1000);

    const result = matchFaces(
      { face_old: bedroom(['v1', 'v2', 'v3', 'v4'], 1_000_000) },
      deriveFaces(moved),
      moved.vertices,
      oldGraph.vertices,
    );

    expect(Object.keys(result.faces)).toEqual(['face_old']);
    expect(result.faces.face_old.area_mm2).toBe(1_001_000);
    expect(result.warnings).toEqual([]);
  });

  it('rejects an exact-signature match when any matching metric is non-finite', () => {
    const nextGraph = rectangle();

    const result = matchFaces(
      {
        face_old: bedroom(
          ['v1', 'v2', 'v3', 'v4'],
          Number.POSITIVE_INFINITY,
        ),
      },
      deriveFaces(nextGraph),
      nextGraph.vertices,
    );

    expect(result.faces).not.toHaveProperty('face_old');
    expect(Object.values(result.faces)[0].function_code).toBeNull();
    expect(result.warnings[0]).toMatchObject({
      code: 'FACE_ANNOTATION_REVIEW',
      entity: { type: 'face', id: 'face_old' },
    });
  });

  it('does not copy one annotation to tied candidates when a room is split', () => {
    const oldGraph = rectangle(0, 0, 4000, 2000);
    const divided = graph(
      {
        v1: { x_mm: 0, y_mm: 0 },
        vb: { x_mm: 2000, y_mm: 0 },
        v2: { x_mm: 4000, y_mm: 0 },
        v3: { x_mm: 4000, y_mm: 2000 },
        vt: { x_mm: 2000, y_mm: 2000 },
        v4: { x_mm: 0, y_mm: 2000 },
      },
      [
        ['w1', 'v1', 'vb'],
        ['w2', 'vb', 'v2'],
        ['w3', 'v2', 'v3'],
        ['w4', 'v3', 'vt'],
        ['w5', 'vt', 'v4'],
        ['w6', 'v4', 'v1'],
        ['w7', 'vb', 'vt'],
      ],
    );

    const result = matchFaces(
      { face_old: bedroom(['v1', 'v2', 'v3', 'v4'], 8_000_000) },
      deriveFaces(divided),
      divided.vertices,
      oldGraph.vertices,
    );

    expect(result.faces).not.toHaveProperty('face_old');
    expect(Object.values(result.faces).map((face) => face.function_code)).toEqual([
      null,
      null,
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      level: 'warning',
      code: 'FACE_ANNOTATION_REVIEW',
      entity: { type: 'face', id: 'face_old' },
    });
  });

  it('warns when an annotated old face disappears', () => {
    const vertices = rectangle().vertices;
    const result = matchFaces(
      { face_old: bedroom(['v1', 'v2', 'v3', 'v4']) },
      [],
      vertices,
    );

    expect(result.faces).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('FACE_ANNOTATION_REVIEW');
  });

  it('warns when a color-only annotated old face disappears', () => {
    const vertices = rectangle().vertices;
    const result = matchFaces(
      { face_color: colorOnly(['v1', 'v2', 'v3', 'v4']) },
      [],
      vertices,
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'FACE_ANNOTATION_REVIEW',
      entity: { type: 'face', id: 'face_color' },
    });
  });

  it('warns instead of copying a color-only annotation to tied split candidates', () => {
    const oldGraph = rectangle(0, 0, 4000, 2000);
    const divided = graph(
      {
        v1: { x_mm: 0, y_mm: 0 },
        vb: { x_mm: 2000, y_mm: 0 },
        v2: { x_mm: 4000, y_mm: 0 },
        v3: { x_mm: 4000, y_mm: 2000 },
        vt: { x_mm: 2000, y_mm: 2000 },
        v4: { x_mm: 0, y_mm: 2000 },
      },
      [
        ['w1', 'v1', 'vb'],
        ['w2', 'vb', 'v2'],
        ['w3', 'v2', 'v3'],
        ['w4', 'v3', 'vt'],
        ['w5', 'vt', 'v4'],
        ['w6', 'v4', 'v1'],
        ['w7', 'vb', 'vt'],
      ],
    );

    const result = matchFaces(
      { face_color: colorOnly(['v1', 'v2', 'v3', 'v4'], 8_000_000) },
      deriveFaces(divided),
      divided.vertices,
      oldGraph.vertices,
    );

    expect(Object.values(result.faces).map((face) => face.color)).toEqual([
      '',
      '',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].entity).toEqual({
      type: 'face',
      id: 'face_color',
    });
  });

  it('does not warn when an unannotated default-color face disappears', () => {
    const vertices = rectangle().vertices;
    const result = matchFaces(
      {
        face_empty: {
          ...colorOnly(['v1', 'v2', 'v3', 'v4']),
          color: '',
        },
      },
      [],
      vertices,
    );

    expect(result.warnings).toEqual([]);
  });

  it('matches one-to-one deterministically regardless of face object and derived order', () => {
    const left = rectangle(0, 0, 2000, 2000, 'l');
    const right = rectangle(3000, 0, 5000, 2000, 'r');
    const vertices = { ...left.vertices, ...right.vertices };
    const oldFaces = {
      face_right: {
        ...bedroom(['r1', 'r2', 'r3', 'r4'], 4_000_000),
        display_name: 'Right',
      },
      face_left: {
        ...bedroom(['l1', 'l2', 'l3', 'l4'], 4_000_000),
        display_name: 'Left',
      },
    };
    const derived = [
      ...deriveFaces(right),
      ...deriveFaces(left),
    ];

    const first = matchFaces(oldFaces, derived, vertices);
    const second = matchFaces(
      Object.fromEntries(Object.entries(oldFaces).reverse()),
      [...derived].reverse(),
      vertices,
    );

    expect(first).toEqual(second);
    expect(first.faces.face_left.display_name).toBe('Left');
    expect(first.faces.face_right.display_name).toBe('Right');
  });

  it('allocates collision-free deterministic IDs after huge numeric suffixes', () => {
    const huge = 'face_90071992547409931234567890';
    const annotated = bedroom(['missing1', 'missing2', 'missing3']);
    const nextGraph = rectangle();

    const result = matchFaces(
      { [huge]: annotated },
      deriveFaces(nextGraph),
      nextGraph.vertices,
    );

    expect(Object.keys(result.faces)).toEqual([
      'face_90071992547409931234567891',
    ]);
  });

  it('copies a new face boundary instead of retaining the derived array', () => {
    const derived = [
      {
        boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
        area_mm2: 12_000_000,
      },
    ];
    const vertices = rectangle().vertices;

    const result = matchFaces({}, derived, vertices);
    Object.values(result.faces)[0].boundary_vertex_ids.push('mutated');

    expect(derived[0].boundary_vertex_ids).toEqual(['v1', 'v2', 'v3', 'v4']);
  });
});

describe('applyDerivedFaces', () => {
  it('purely updates faces and floor references while replacing prior face-review warnings', () => {
    const document = createEmptyBuilding(
      'house_faces',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    const room = rectangle();
    document.vertices = room.vertices;
    document.walls = room.walls;
    document.faces = {
      face_old: bedroom(['v1', 'v2', 'v3', 'v4']),
    };
    document.floors[0].face_ids = ['stale'];
    document.validation.issues = [
      {
        id: 'keep-me',
        level: 'error',
        code: 'OTHER',
        message: 'Unrelated',
      },
      {
        id: 'old-face-review',
        level: 'warning',
        code: 'FACE_ANNOTATION_REVIEW',
        message: 'Stale',
      },
    ];

    const result = applyDerivedFaces(document, deriveFaces(document));

    expect(result).not.toBe(document);
    expect(result.faces.face_old.function_code).toBe('bedroom');
    expect(result.floors[0].face_ids).toEqual(['face_old']);
    expect(result.validation.issues).toEqual([
      {
        id: 'keep-me',
        level: 'error',
        code: 'OTHER',
        message: 'Unrelated',
      },
    ]);
    expect(document.floors[0].face_ids).toEqual(['stale']);
    expect(document.validation.issues).toHaveLength(2);
    expect(result.metadata).toBe(document.metadata);
  });
});
