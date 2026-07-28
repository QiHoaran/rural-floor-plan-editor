import { describe, expect, it } from 'vitest';
import type {
  BuildingDocument,
  BuildingVertex,
  BuildingWall,
} from '../../src/editor/domain/buildingTypes.ts';
import {
  deriveFaces,
  geometryBoundarySignature,
} from '../../src/editor/topology/faceTraversal.ts';

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

const rectangleVertices = {
  v1: { x_mm: 0, y_mm: 0 },
  v2: { x_mm: 3000, y_mm: 0 },
  v3: { x_mm: 3000, y_mm: 4000 },
  v4: { x_mm: 0, y_mm: 4000 },
};

const rectangleEdges: Array<[string, string, string]> = [
  ['w1', 'v1', 'v2'],
  ['w2', 'v2', 'v3'],
  ['w3', 'v3', 'v4'],
  ['w4', 'v4', 'v1'],
];

describe('deriveFaces', () => {
  it('derives one bounded face from a rectangular wall loop', () => {
    const faces = deriveFaces(graph(rectangleVertices, rectangleEdges));

    expect(faces).toEqual([
      {
        boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
        area_mm2: 12_000_000,
      },
    ]);
  });

  it('derives two bounded faces separated by a shared wall', () => {
    const faces = deriveFaces(
      graph(
        {
          a: { x_mm: 0, y_mm: 0 },
          b: { x_mm: 3000, y_mm: 0 },
          c: { x_mm: 6000, y_mm: 0 },
          d: { x_mm: 6000, y_mm: 4000 },
          e: { x_mm: 3000, y_mm: 4000 },
          f: { x_mm: 0, y_mm: 4000 },
        },
        [
          ['bottom-left', 'a', 'b'],
          ['bottom-right', 'b', 'c'],
          ['right', 'c', 'd'],
          ['top-right', 'd', 'e'],
          ['top-left', 'e', 'f'],
          ['left', 'f', 'a'],
          ['divider', 'b', 'e'],
        ],
      ),
    );

    expect(faces).toHaveLength(2);
    expect(faces.map((face) => face.area_mm2)).toEqual([
      12_000_000, 12_000_000,
    ]);
    expect(faces.map((face) => face.boundary_vertex_ids)).toEqual([
      ['a', 'b', 'e', 'f'],
      ['b', 'c', 'd', 'e'],
    ]);
  });

  it('does not create a face from an open chain or tree', () => {
    const open = graph(
      {
        a: { x_mm: 0, y_mm: 0 },
        b: { x_mm: 1000, y_mm: 0 },
        c: { x_mm: 1000, y_mm: 1000 },
        d: { x_mm: 2000, y_mm: 0 },
      },
      [
        ['w1', 'a', 'b'],
        ['w2', 'b', 'c'],
        ['w3', 'b', 'd'],
      ],
    );

    expect(deriveFaces(open)).toEqual([]);
  });

  it('removes a dangling-wall excursion while retaining the surrounding simple face', () => {
    const withSpur = graph(
      {
        ...rectangleVertices,
        spur: { x_mm: 1000, y_mm: 1000 },
      },
      [
        ...rectangleEdges,
        ['spur-wall', 'v1', 'spur'],
      ],
    );

    expect(deriveFaces(withSpur)).toEqual([
      {
        boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
        area_mm2: 12_000_000,
      },
    ]);
  });

  it('is independent of wall and vertex object insertion order', () => {
    const reversed = graph(
      Object.fromEntries(Object.entries(rectangleVertices).reverse()),
      [...rectangleEdges].reverse(),
    );

    expect(deriveFaces(reversed)).toEqual(
      deriveFaces(graph(rectangleVertices, rectangleEdges)),
    );
  });

  it('supports negative coordinates and rounds non-integral shoelace area', () => {
    const faces = deriveFaces(
      graph(
        {
          a: { x_mm: -3, y_mm: -2 },
          b: { x_mm: 2, y_mm: -2 },
          c: { x_mm: 2, y_mm: 1 },
          d: { x_mm: -3, y_mm: 2 },
        },
        [
          ['w1', 'a', 'b'],
          ['w2', 'b', 'c'],
          ['w3', 'c', 'd'],
          ['w4', 'd', 'a'],
        ],
      ),
    );

    expect(faces[0].area_mm2).toBe(18);
    expect(faces[0].boundary_vertex_ids[0]).toBe('a');
    expect(faces[0].boundary_vertex_ids.at(-1)).not.toBe(
      faces[0].boundary_vertex_ids[0],
    );
  });

  it('derives an exact unit-area face near the maximum safe integer coordinate', () => {
    const origin = 9_000_000_000_000_000;
    const faces = deriveFaces(
      graph(
        {
          a: { x_mm: origin, y_mm: origin },
          b: { x_mm: origin + 1, y_mm: origin },
          c: { x_mm: origin + 1, y_mm: origin + 1 },
          d: { x_mm: origin, y_mm: origin + 1 },
        },
        [
          ['w1', 'a', 'b'],
          ['w2', 'b', 'c'],
          ['w3', 'c', 'd'],
          ['w4', 'd', 'a'],
        ],
      ),
    );

    expect(faces).toEqual([
      {
        boundary_vertex_ids: ['a', 'b', 'c', 'd'],
        area_mm2: 1,
      },
    ]);
  });

  it('orders degree-five near-direction rays exactly at large safe-integer coordinates', () => {
    const n = 9_000_000_000_000_000;
    const vertices = {
      o: { x_mm: 0, y_mm: 0 },
      a: { x_mm: n, y_mm: n - 1 },
      b: { x_mm: n - 1, y_mm: n - 1 },
      c: { x_mm: -n, y_mm: n },
      d: { x_mm: -n, y_mm: -n },
      e: { x_mm: n, y_mm: -n },
    };
    const edges: Array<[string, string, string]> = [
      ['outer-ea', 'e', 'a'],
      ['outer-ab', 'a', 'b'],
      ['outer-bc', 'b', 'c'],
      ['outer-cd', 'c', 'd'],
      ['outer-de', 'd', 'e'],
      ['ray-a', 'o', 'a'],
      ['ray-b', 'o', 'b'],
      ['ray-c', 'o', 'c'],
      ['ray-d', 'o', 'd'],
      ['ray-e', 'o', 'e'],
    ];

    const forward = deriveFaces(graph(vertices, edges));
    const reversed = deriveFaces(graph(vertices, [...edges].reverse()));
    const signatures = (faces: typeof forward) =>
      faces
        .map((face) =>
          geometryBoundarySignature(face.boundary_vertex_ids, vertices),
        )
        .sort();

    expect(forward).toHaveLength(5);
    expect(forward.every((face) => face.boundary_vertex_ids.length === 3)).toBe(
      true,
    );
    expect(reversed).toHaveLength(5);
    expect(signatures(reversed)).toEqual(signatures(forward));
  });

  it('keeps split collinear points in the face boundary but ignores them in its geometry signature', () => {
    const splitVertices = {
      ...rectangleVertices,
      vm: { x_mm: 1500, y_mm: 0 },
    };
    const split = graph(splitVertices, [
      ['w1a', 'v1', 'vm'],
      ['w1b', 'vm', 'v2'],
      ...rectangleEdges.slice(1),
    ]);
    const [face] = deriveFaces(split);

    expect(face.boundary_vertex_ids).toEqual(['v1', 'vm', 'v2', 'v3', 'v4']);
    expect(geometryBoundarySignature(face.boundary_vertex_ids, splitVertices)).toBe(
      geometryBoundarySignature(
        ['v1', 'v2', 'v3', 'v4'],
        rectangleVertices,
      ),
    );
  });

  it('deterministically ignores invalid references, zero-length walls, and duplicate edges', () => {
    const invalid = graph(
      {
        ...rectangleVertices,
        same: { x_mm: 0, y_mm: 0 },
      },
      [
        ...rectangleEdges,
        ['missing', 'v1', 'not-there'],
        ['zero-by-id', 'v1', 'v1'],
        ['zero-by-coordinate', 'v1', 'same'],
        ['duplicate', 'v2', 'v1'],
      ],
    );

    expect(deriveFaces(invalid)).toEqual([
      {
        boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
        area_mm2: 12_000_000,
      },
    ]);
  });
});
