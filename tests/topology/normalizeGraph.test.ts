import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type {
  BuildingDocument,
  BuildingVertex,
  BuildingWall,
} from '../../src/editor/domain/buildingTypes.ts';
import {
  insertWall,
  normalizeGraph,
  type WallCandidate,
} from '../../src/editor/topology/normalizeGraph.ts';

const DEFAULT_WALL = {
  wall_type: 'interior',
  thickness_mm: 120,
  height_mm: 2800,
  material_type: 'brick',
  notes: 'preserve me',
} as const;

function emptyDocument(): BuildingDocument {
  return createEmptyBuilding(
    'house_topology',
    'reference/original.png',
    240,
    '2026-07-27T00:00:00.000Z',
  );
}

function addWall(
  document: BuildingDocument,
  id: string,
  startId: string,
  start: BuildingVertex,
  endId: string,
  end: BuildingVertex,
  properties: Omit<BuildingWall, 'start_vertex_id' | 'end_vertex_id'> = DEFAULT_WALL,
): void {
  document.vertices[startId] = start;
  document.vertices[endId] = end;
  document.walls[id] = {
    start_vertex_id: startId,
    end_vertex_id: endId,
    ...properties,
  };
  document.floors[0].wall_ids.push(id);
}

function candidate(
  start: BuildingVertex,
  end: BuildingVertex,
  properties: Omit<BuildingWall, 'start_vertex_id' | 'end_vertex_id'> = DEFAULT_WALL,
): WallCandidate {
  return { start, end, ...properties };
}

function vertexIdAt(document: BuildingDocument, x_mm: number, y_mm: number): string {
  const matches = Object.entries(document.vertices).filter(
    ([, vertex]) => vertex.x_mm === x_mm && vertex.y_mm === y_mm,
  );
  expect(matches).toHaveLength(1);
  return matches[0][0];
}

function incidentWallIds(document: BuildingDocument, vertexId: string): string[] {
  return Object.entries(document.walls)
    .filter(
      ([, wall]) =>
        wall.start_vertex_id === vertexId || wall.end_vertex_id === vertexId,
    )
    .map(([wallId]) => wallId);
}

function wallCoordinatePairs(document: BuildingDocument, wallIds: string[]) {
  return wallIds.map((wallId) => {
    const wall = document.walls[wallId];
    return [
      document.vertices[wall.start_vertex_id],
      document.vertices[wall.end_vertex_id],
    ];
  });
}

function edgeCoordinateKeys(document: BuildingDocument): string[] {
  return Object.values(document.walls)
    .map((wall) => {
      const endpoints = [
        document.vertices[wall.start_vertex_id],
        document.vertices[wall.end_vertex_id],
      ].sort(
        (left, right) =>
          left.x_mm - right.x_mm || left.y_mm - right.y_mm,
      );
      return endpoints
        .map((point) => `${point.x_mm},${point.y_mm}`)
        .join('->');
    })
    .sort();
}

describe('insertWall', () => {
  it('creates a T junction by splitting the host and sharing one vertex', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 2000, y_mm: 0 },
    );

    const result = insertWall(
      document,
      candidate({ x_mm: 1000, y_mm: 1000 }, { x_mm: 1000, y_mm: 0 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const junctionId = vertexIdAt(result.document, 1000, 0);
    expect(incidentWallIds(result.document, junctionId)).toHaveLength(3);
    expect(Object.keys(result.document.walls)).toHaveLength(3);
    expect(result.document.walls).not.toHaveProperty('w_0001');
    expect(result.createdWallIds).toHaveLength(1);
  });

  it('creates an X junction with one center vertex referenced by four subwalls', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 2000, y_mm: 2000 },
    );

    const result = insertWall(
      document,
      candidate({ x_mm: 0, y_mm: 2000 }, { x_mm: 2000, y_mm: 0 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const centerId = vertexIdAt(result.document, 1000, 1000);
    expect(incidentWallIds(result.document, centerId)).toHaveLength(4);
    expect(Object.keys(result.document.walls)).toHaveLength(4);
    expect(result.createdWallIds).toHaveLength(2);
  });

  it('sorts three crossings along the candidate and splits all four walls', () => {
    const document = emptyDocument();
    for (const [index, x] of [1000, 2000, 3000].entries()) {
      addWall(
        document,
        `w_000${index + 1}`,
        `v_000${index * 2 + 1}`,
        { x_mm: x, y_mm: -1000 },
        `v_000${index * 2 + 2}`,
        { x_mm: x, y_mm: 1000 },
      );
    }

    const result = insertWall(
      document,
      candidate({ x_mm: 0, y_mm: 0 }, { x_mm: 4000, y_mm: 0 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdWallIds).toHaveLength(4);
    expect(Object.keys(result.document.walls)).toHaveLength(10);
    expect(
      wallCoordinatePairs(result.document, result.createdWallIds).map(
        ([start, end]) => [start.x_mm, end.x_mm],
      ),
    ).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 3000],
      [3000, 4000],
    ]);
  });

  it('reuses one shared point when several walls already meet at the same coordinate', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: -1000, y_mm: 0 },
      'v_center',
      { x_mm: 0, y_mm: 0 },
    );
    addWall(
      document,
      'w_0002',
      'v_center',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );

    const result = insertWall(
      document,
      candidate({ x_mm: 0, y_mm: -1000 }, { x_mm: 0, y_mm: 1000 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const centerId = vertexIdAt(result.document, 0, 0);
    expect(centerId).toBe('v_center');
    expect(incidentWallIds(result.document, centerId)).toHaveLength(4);
  });

  it('uses one theoretical center for an ambiguous tolerance cluster regardless of wall order', () => {
    function insertWithOrder(order: Array<'upper' | 'lower'>) {
      const document = emptyDocument();
      for (const position of order) {
        if (position === 'upper') {
          addWall(
            document,
            'w_upper',
            'v_upper_near',
            { x_mm: 1000, y_mm: 1 },
            'v_upper_far',
            { x_mm: 1000, y_mm: 1000 },
          );
        } else {
          addWall(
            document,
            'w_lower',
            'v_lower_far',
            { x_mm: 1000, y_mm: -1000 },
            'v_lower_near',
            { x_mm: 1000, y_mm: -1 },
          );
        }
      }
      return insertWall(
        document,
        candidate({ x_mm: 0, y_mm: 0 }, { x_mm: 2000, y_mm: 0 }),
      );
    }

    const upperFirst = insertWithOrder(['upper', 'lower']);
    const lowerFirst = insertWithOrder(['lower', 'upper']);

    expect(upperFirst.ok).toBe(true);
    expect(lowerFirst.ok).toBe(true);
    if (!upperFirst.ok || !lowerFirst.ok) return;
    for (const result of [upperFirst, lowerFirst]) {
      const centerId = vertexIdAt(result.document, 1000, 0);
      expect(incidentWallIds(result.document, centerId)).toHaveLength(4);
      expect(Object.values(result.document.vertices)).not.toContainEqual({
        x_mm: 1000,
        y_mm: 1,
      });
      expect(Object.values(result.document.vertices)).not.toContainEqual({
        x_mm: 1000,
        y_mm: -1,
      });
      expect(Object.keys(result.document.vertices)).toHaveLength(5);
    }
    expect(edgeCoordinateKeys(upperFirst.document)).toEqual(
      edgeCoordinateKeys(lowerFirst.document),
    );
  });

  it('clusters theoretical intersections across a rounding boundary regardless of wall order', () => {
    function insertWithOrder(order: Array<'first' | 'second'>) {
      const document = emptyDocument();
      for (const position of order) {
        if (position === 'first') {
          addWall(
            document,
            'w_first',
            'v_common',
            { x_mm: 0, y_mm: 1 },
            'v_first_far',
            { x_mm: 49, y_mm: -50 },
          );
        } else {
          addWall(
            document,
            'w_second',
            'v_common',
            { x_mm: 0, y_mm: 1 },
            'v_second_far',
            { x_mm: 51, y_mm: -48 },
          );
        }
      }
      return insertWall(
        document,
        candidate(
          { x_mm: -10, y_mm: -10 },
          { x_mm: 10, y_mm: 10 },
        ),
      );
    }

    const firstOrder = insertWithOrder(['first', 'second']);
    const reverseOrder = insertWithOrder(['second', 'first']);

    expect(firstOrder.ok).toBe(true);
    expect(reverseOrder.ok).toBe(true);
    if (!firstOrder.ok || !reverseOrder.ok) return;
    for (const result of [firstOrder, reverseOrder]) {
      const sharedVertexIds = Object.keys(result.document.vertices).filter(
        (vertexId) =>
          incidentWallIds(result.document, vertexId).length === 4,
      );
      expect(sharedVertexIds).toHaveLength(1);
      expect(Object.keys(result.document.vertices)).toHaveLength(5);
      expect(result.createdWallIds).toHaveLength(2);
      expect(
        Object.values(result.document.vertices).filter(
          (vertex) =>
            (vertex.x_mm === 0 && vertex.y_mm === 0) ||
            (vertex.x_mm === 1 && vertex.y_mm === 1),
        ),
      ).toHaveLength(1);
    }
    expect(edgeCoordinateKeys(firstOrder.document)).toEqual(
      edgeCoordinateKeys(reverseOrder.document),
    );
  });

  it('rewires a candidate endpoint when final rounding moves its clustered center beyond tolerance', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_host_start',
      { x_mm: -7, y_mm: 4 },
      'v_host_far',
      { x_mm: 7, y_mm: -2 },
    );

    const result = insertWall(
      document,
      candidate({ x_mm: 0, y_mm: 0 }, { x_mm: 10, y_mm: 10 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const centerId = vertexIdAt(result.document, 1, 1);
    expect(incidentWallIds(result.document, centerId)).toHaveLength(3);
    expect(result.createdWallIds).toHaveLength(1);
    expect(Object.values(result.document.vertices)).not.toContainEqual({
      x_mm: 0,
      y_mm: 0,
    });
  });

  it('unions multiple tolerance events anchored to the same candidate endpoint regardless of wall order', () => {
    function insertWithOrder(order: Array<'left' | 'right'>) {
      const document = emptyDocument();
      for (const side of order) {
        const x = side === 'left' ? -1 : 1;
        addWall(
          document,
          `w_${side}`,
          `v_${side}_bottom`,
          { x_mm: x, y_mm: -10 },
          `v_${side}_top`,
          { x_mm: x, y_mm: 10 },
        );
      }
      return insertWall(
        document,
        candidate({ x_mm: 0, y_mm: 0 }, { x_mm: 10, y_mm: 0 }),
      );
    }

    const leftFirst = insertWithOrder(['left', 'right']);
    const rightFirst = insertWithOrder(['right', 'left']);

    expect(leftFirst.ok).toBe(true);
    expect(rightFirst.ok).toBe(true);
    if (!leftFirst.ok || !rightFirst.ok) return;
    for (const result of [leftFirst, rightFirst]) {
      const startId = vertexIdAt(result.document, 0, 0);
      expect(incidentWallIds(result.document, startId)).toHaveLength(5);
      expect(result.createdWallIds).toHaveLength(1);
      expect(Object.keys(result.document.vertices)).toHaveLength(6);
    }
    expect(edgeCoordinateKeys(leftFirst.document)).toEqual(
      edgeCoordinateKeys(rightFirst.document),
    );
  });

  it('rejects a candidate whose endpoints collapse into one intersection cluster', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: -10, y_mm: 21 },
      'v_0002',
      { x_mm: 10, y_mm: -19 },
    );
    addWall(
      document,
      'w_0002',
      'v_0003',
      { x_mm: -10, y_mm: 23 },
      'v_0004',
      { x_mm: 10, y_mm: -17 },
    );
    const originalDocument = document;
    const originalWalls = document.walls;
    const before = structuredClone(document);

    const result = insertWall(
      document,
      candidate({ x_mm: 0, y_mm: 0 }, { x_mm: 2, y_mm: 0 }),
    );

    expect(result).toEqual({
      ok: false,
      code: 'ZERO_LENGTH',
      conflictingWallIds: [],
    });
    expect(document).toBe(originalDocument);
    expect(document.walls).toBe(originalWalls);
    expect(document).toEqual(before);
  });

  it('reuses an existing vertex for endpoint contact within tolerance', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );

    const result = insertWall(
      document,
      candidate({ x_mm: 1001, y_mm: 0 }, { x_mm: 1000, y_mm: 1000 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.values(result.document.vertices)).not.toContainEqual({
      x_mm: 1001,
      y_mm: 0,
    });
    expect(result.document.walls[result.createdWallIds[0]].start_vertex_id).toBe(
      'v_0002',
    );
  });

  it('rejects a zero-length candidate without mutating the input', () => {
    const document = emptyDocument();
    const before = structuredClone(document);

    expect(
      insertWall(
        document,
        candidate({ x_mm: 50, y_mm: 50 }, { x_mm: 50, y_mm: 50 }),
      ),
    ).toEqual({
      ok: false,
      code: 'ZERO_LENGTH',
      conflictingWallIds: [],
    });
    expect(document).toEqual(before);
  });

  it('rejects the same undirected edge without mutating the input', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );
    const before = structuredClone(document);

    expect(
      insertWall(
        document,
        candidate({ x_mm: 1000, y_mm: 0 }, { x_mm: 0, y_mm: 0 }),
      ),
    ).toEqual({
      ok: false,
      code: 'DUPLICATE_EDGE',
      conflictingWallIds: ['w_0001'],
    });
    expect(document).toEqual(before);
  });

  it.each([
    [{ x_mm: 0, y_mm: 0 }, { x_mm: 1000, y_mm: 0 }],
    [{ x_mm: 500, y_mm: 0 }, { x_mm: 1500, y_mm: 0 }],
  ])('rejects a complete or partial collinear overlap', (start, end) => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );

    const result = insertWall(document, candidate(start, end));

    expect(result).toEqual({
      ok: false,
      code:
        start.x_mm === 0 ? 'DUPLICATE_EDGE' : 'COLLINEAR_OVERLAP',
      conflictingWallIds: ['w_0001'],
    });
  });

  it('allows collinear end-to-end contact', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );

    const result = insertWall(
      document,
      candidate({ x_mm: 1000, y_mm: 0 }, { x_mm: 2000, y_mm: 0 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.document.walls)).toHaveLength(2);
    expect(
      result.document.walls[result.createdWallIds[0]].start_vertex_id,
    ).toBe('v_0002');
  });

  it('rejects an exactly one millimeter positive-length collinear overlap', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 10, y_mm: 0 },
    );
    const before = structuredClone(document);

    expect(
      insertWall(
        document,
        candidate({ x_mm: 9, y_mm: 0 }, { x_mm: 20, y_mm: 0 }),
      ),
    ).toEqual({
      ok: false,
      code: 'COLLINEAR_OVERLAP',
      conflictingWallIds: ['w_0001'],
    });
    expect(document).toEqual(before);
  });

  it('leaves a non-intersecting wall unchanged', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );
    const originalWall = structuredClone(document.walls.w_0001);

    const result = insertWall(
      document,
      candidate({ x_mm: 0, y_mm: 1000 }, { x_mm: 1000, y_mm: 1000 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.walls.w_0001).toEqual(originalWall);
    expect(result.document.floors[0].wall_ids).toContain('w_0001');
  });

  it('allocates collision-free IDs after suffixes beyond Number.MAX_SAFE_INTEGER', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_9007199254740992',
      'v_9007199254740992',
      { x_mm: 0, y_mm: 0 },
      'v_base',
      { x_mm: 1000, y_mm: 0 },
    );

    const result = insertWall(
      document,
      candidate({ x_mm: 0, y_mm: 1000 }, { x_mm: 1000, y_mm: 1000 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdWallIds).toEqual(['w_9007199254740993']);
    expect(result.document.vertices).toHaveProperty(
      'v_9007199254740993',
    );
    expect(result.document.vertices).toHaveProperty(
      'v_9007199254740994',
    );
    expect(new Set(Object.keys(result.document.vertices)).size).toBe(
      Object.keys(result.document.vertices).length,
    );
  }, 1000);

  it('inherits attributes, replaces floor references, and removes orphan vertices', () => {
    const document = emptyDocument();
    const hostProperties = {
      wall_type: 'exterior',
      thickness_mm: 360,
      height_mm: 3200,
      material_type: 'stone',
      notes: 'host attributes',
    } as const;
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 2000, y_mm: 0 },
      hostProperties,
    );
    document.vertices.v_orphan = { x_mm: 9999, y_mm: 9999 };

    const result = insertWall(
      document,
      candidate({ x_mm: 1000, y_mm: -1000 }, { x_mm: 1000, y_mm: 1000 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hostChildren = Object.entries(result.document.walls)
      .filter(([, wall]) => wall.notes === hostProperties.notes)
      .map(([id, wall]) => ({ id, wall }));
    expect(hostChildren).toHaveLength(2);
    for (const { id, wall } of hostChildren) {
      expect(wall).toMatchObject(hostProperties);
      expect(result.document.floors[0].wall_ids).toContain(id);
    }
    expect(result.document.floors[0].wall_ids).not.toContain('w_0001');
    expect(result.document.walls).not.toHaveProperty('w_0001');
    expect(result.document.vertices).not.toHaveProperty('v_orphan');
  });
});

describe('normalizeGraph', () => {
  it('normalizes existing crossing walls into one shared center vertex', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 2000, y_mm: 2000 },
    );
    addWall(
      document,
      'w_0002',
      'v_0003',
      { x_mm: 0, y_mm: 2000 },
      'v_0004',
      { x_mm: 2000, y_mm: 0 },
    );

    const result = normalizeGraph(document);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdWallIds).toEqual([]);
    const centerId = vertexIdAt(result.document, 1000, 1000);
    expect(incidentWallIds(result.document, centerId)).toHaveLength(4);
    expect(Object.keys(result.document.walls)).toHaveLength(4);
    expect(document.walls).toHaveProperty('w_0001');
    expect(document.walls).toHaveProperty('w_0002');
  });

  it('returns a ZERO_LENGTH failure without changing the input', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 0, y_mm: 0 },
    );
    const before = structuredClone(document);

    expect(normalizeGraph(document)).toEqual({
      ok: false,
      code: 'ZERO_LENGTH',
      conflictingWallIds: ['w_0001'],
    });
    expect(document).toEqual(before);
  });

  it('returns a DUPLICATE_EDGE failure without changing the input', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );
    addWall(
      document,
      'w_0002',
      'v_0003',
      { x_mm: 1000, y_mm: 0 },
      'v_0004',
      { x_mm: 0, y_mm: 0 },
    );
    const before = structuredClone(document);

    expect(normalizeGraph(document)).toEqual({
      ok: false,
      code: 'DUPLICATE_EDGE',
      conflictingWallIds: ['w_0001', 'w_0002'],
    });
    expect(document).toEqual(before);
  });

  it('returns a COLLINEAR_OVERLAP failure without changing the input', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 1000, y_mm: 0 },
    );
    addWall(
      document,
      'w_0002',
      'v_0003',
      { x_mm: 500, y_mm: 0 },
      'v_0004',
      { x_mm: 1500, y_mm: 0 },
    );
    const before = structuredClone(document);

    expect(normalizeGraph(document)).toEqual({
      ok: false,
      code: 'COLLINEAR_OVERLAP',
      conflictingWallIds: ['w_0001', 'w_0002'],
    });
    expect(document).toEqual(before);
  });

  it('rewires symmetric near-endpoint contact to one canonical vertex', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: -1000, y_mm: 0 },
      'v_0002',
      { x_mm: -1, y_mm: 0 },
    );
    addWall(
      document,
      'w_0002',
      'v_0003',
      { x_mm: 0, y_mm: 1 },
      'v_0004',
      { x_mm: 0, y_mm: 1000 },
    );

    const result = normalizeGraph(document);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const junctionId = vertexIdAt(result.document, 0, 0);
    expect(incidentWallIds(result.document, junctionId)).toEqual([
      'w_0001',
      'w_0002',
    ]);
    expect(Object.keys(result.document.vertices)).toHaveLength(3);
  });

  it('allocates collision-free split IDs after suffixes beyond Number.MAX_SAFE_INTEGER', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_9007199254740992',
      'v_9007199254740992',
      { x_mm: 0, y_mm: 0 },
      'v_0001',
      { x_mm: 2000, y_mm: 2000 },
    );
    addWall(
      document,
      'w_0001',
      'v_0002',
      { x_mm: 0, y_mm: 2000 },
      'v_0003',
      { x_mm: 2000, y_mm: 0 },
    );

    const result = normalizeGraph(document);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.vertices).toHaveProperty(
      'v_9007199254740993',
      { x_mm: 1000, y_mm: 1000 },
    );
    expect(Object.keys(result.document.walls)).toContain(
      'w_9007199254740993',
    );
    expect(new Set(Object.keys(result.document.walls)).size).toBe(
      Object.keys(result.document.walls).length,
    );
  }, 1000);

  it('is idempotent after a document has been normalized once', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: 0, y_mm: 0 },
      'v_0002',
      { x_mm: 2000, y_mm: 2000 },
    );
    addWall(
      document,
      'w_0002',
      'v_0003',
      { x_mm: 0, y_mm: 2000 },
      'v_0004',
      { x_mm: 2000, y_mm: 0 },
    );

    const first = normalizeGraph(document);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = normalizeGraph(first.document);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.document).toEqual(first.document);
    expect(second.createdWallIds).toEqual([]);
    // After the first normalization every vertex ID is already canonical,
    // so the second pass must return an identity mapping.
    const vertexIds = Object.keys(first.document.vertices).sort();
    expect(second.canonicalVertexIds).toEqual(
      Object.fromEntries(vertexIds.map((id) => [id, id])),
    );
  });

  it('unions multiple events anchored to the same existing wall endpoint regardless of wall order', () => {
    type WallName = 'horizontal' | 'left' | 'right';
    function normalizeWithOrder(order: WallName[]) {
      const document = emptyDocument();
      for (const wallName of order) {
        if (wallName === 'horizontal') {
          addWall(
            document,
            'w_horizontal',
            'v_origin',
            { x_mm: 0, y_mm: 0 },
            'v_horizontal_end',
            { x_mm: 10, y_mm: 0 },
          );
        } else {
          const x = wallName === 'left' ? -1 : 1;
          addWall(
            document,
            `w_${wallName}`,
            `v_${wallName}_bottom`,
            { x_mm: x, y_mm: -10 },
            `v_${wallName}_top`,
            { x_mm: x, y_mm: 10 },
          );
        }
      }
      return normalizeGraph(document);
    }

    const horizontalFirst = normalizeWithOrder([
      'horizontal',
      'left',
      'right',
    ]);
    const horizontalLast = normalizeWithOrder([
      'right',
      'left',
      'horizontal',
    ]);

    expect(horizontalFirst.ok).toBe(true);
    expect(horizontalLast.ok).toBe(true);
    if (!horizontalFirst.ok || !horizontalLast.ok) return;
    for (const result of [horizontalFirst, horizontalLast]) {
      const originId = vertexIdAt(result.document, 0, 0);
      expect(originId).toBe('v_origin');
      expect(incidentWallIds(result.document, originId)).toHaveLength(5);
      expect(Object.keys(result.document.vertices)).toHaveLength(6);
    }
    expect(edgeCoordinateKeys(horizontalFirst.document)).toEqual(
      edgeCoordinateKeys(horizontalLast.document),
    );
  });

  it('rejects an existing wall whose endpoints collapse into one intersection cluster', () => {
    const document = emptyDocument();
    addWall(
      document,
      'w_candidate',
      'v_candidate_start',
      { x_mm: 0, y_mm: 0 },
      'v_candidate_end',
      { x_mm: 2, y_mm: 0 },
    );
    addWall(
      document,
      'w_0001',
      'v_0001',
      { x_mm: -10, y_mm: 21 },
      'v_0002',
      { x_mm: 10, y_mm: -19 },
    );
    addWall(
      document,
      'w_0002',
      'v_0003',
      { x_mm: -10, y_mm: 23 },
      'v_0004',
      { x_mm: 10, y_mm: -17 },
    );
    const originalDocument = document;
    const originalWalls = document.walls;
    const before = structuredClone(document);

    const result = normalizeGraph(document);

    expect(result).toEqual({
      ok: false,
      code: 'ZERO_LENGTH',
      conflictingWallIds: ['w_candidate'],
    });
    expect(document).toBe(originalDocument);
    expect(document.walls).toBe(originalWalls);
    expect(document).toEqual(before);
  });
});
