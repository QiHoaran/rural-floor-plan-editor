import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import {
  createIdleWallCommand,
  reduceWallCommand,
  type WallCommandContext,
  type WallCommandState,
} from '../../src/editor/commands/wallCommand.ts';
import type { BuildingDocument } from '../../src/editor/domain/buildingTypes.ts';

function createContext(
  overrides: Partial<WallCommandContext> = {},
): WallCommandContext {
  let vertex = 0;
  let wall = 0;
  return {
    wallType: 'exterior',
    polyline: false,
    wallThicknessMm: 370,
    wallHeightMm: 3000,
    materialType: 'brick',
    document: createEmptyBuilding('house_0001', 'reference/original.png'),
    nextId: (kind) =>
      kind === 'vertex' ? `v_${++vertex}` : `w_${++wall}`,
    ...overrides,
  };
}

function startAndMove(context = createContext()): WallCommandState {
  const started = reduceWallCommand(
    createIdleWallCommand(),
    { type: 'START', point: { x_mm: 1000, y_mm: 1000 } },
    context,
  ).state;
  return reduceWallCommand(
    started,
    {
      type: 'MOVE',
      point: { x_mm: 3000, y_mm: 1400 },
      constraint: 'orthogonal',
    },
    context,
  ).state;
}

describe('wall command state machine', () => {
  it('moves from idle to a constrained preview', () => {
    const state = startAndMove();

    expect(state).toMatchObject({
      phase: 'drawing',
      start: { point: { x_mm: 1000, y_mm: 1000 } },
      previewEnd: { x_mm: 3000, y_mm: 1000 },
      angleDeg: 0,
    });
  });

  it('commits an exact typed meter length as one transaction', () => {
    const context = createContext();
    const drawing = startAndMove();
    const withInput = reduceWallCommand(
      drawing,
      { type: 'INPUT', value: '4.5' },
      context,
    ).state;
    const committed = reduceWallCommand(
      withInput,
      { type: 'CONFIRM' },
      context,
    );

    expect(committed.state).toEqual({
      phase: 'idle',
      continuationAnchor: {
        point: { x_mm: 5500, y_mm: 1000 },
        vertexId: expect.any(String),
      },
      lastSegment: { dxMm: 4500, dyMm: 0 },
    });
    expect(committed.transaction?.description).toBe('绘制外墙');

    const document = committed.transaction!.apply(
      createEmptyBuilding('house_0001', 'reference/original.png'),
    );
    expect(Object.values(document.vertices)).toEqual(
      expect.arrayContaining([
        { x_mm: 1000, y_mm: 1000 },
        { x_mm: 5500, y_mm: 1000 },
      ]),
    );
    expect(Object.values(document.walls)[0]).toMatchObject({
      wall_type: 'exterior',
      thickness_mm: 370,
    });
    expect(document.floors[0].wall_ids).toHaveLength(1);
  });

  it('commits a clicked endpoint without numeric input', () => {
    const context = createContext();
    const drawing = startAndMove();
    const committed = reduceWallCommand(
      drawing,
      { type: 'CONFIRM' },
      context,
    );
    const document = committed.transaction!.apply(
      createEmptyBuilding('house_0001', 'reference/original.png'),
    );

    expect(Object.values(document.vertices)).toContainEqual({
      x_mm: 3000,
      y_mm: 1000,
    });
  });

  it('applies a prepared wall transaction to the current document', () => {
    const context = createContext();
    const prepared = reduceWallCommand(
      startAndMove(context),
      { type: 'CONFIRM' },
      context,
    );
    const current = structuredClone(context.document!);
    current.vertices.v_external_start = { x_mm: 10_000, y_mm: 10_000 };
    current.vertices.v_external_end = { x_mm: 11_000, y_mm: 10_000 };
    current.walls.w_external = {
      start_vertex_id: 'v_external_start',
      end_vertex_id: 'v_external_end',
      wall_type: 'interior',
      thickness_mm: 240,
      height_mm: 3000,
      material_type: 'brick',
    };
    current.floors[0].wall_ids.push('w_external');
    current.metadata.revision = 17;

    const applied = prepared.transaction!.apply(current);

    expect(applied.metadata.revision).toBe(17);
    expect(applied.walls.w_external).toEqual(current.walls.w_external);
    expect(Object.keys(applied.walls)).toHaveLength(2);
  });

  it.each([
    ['v_z first', ['v_z', 'v_a']],
    ['v_a first', ['v_a', 'v_z']],
  ] as const)(
    'uses the created wall endpoint as anchor when equidistant vertices exist: %s',
    (_, vertexOrder) => {
      const document = createEmptyBuilding(
        'house_0001',
        'reference/original.png',
      );
      const points = {
        v_z: { x_mm: -1, y_mm: 0 },
        v_a: { x_mm: 1, y_mm: 0 },
      };
      for (const vertexId of vertexOrder) {
        document.vertices[vertexId] = points[vertexId];
      }
      document.vertices.v_z_anchor = { x_mm: -1001, y_mm: 0 };
      document.vertices.v_a_anchor = { x_mm: 1001, y_mm: 0 };
      document.walls.w_z = {
        start_vertex_id: 'v_z_anchor',
        end_vertex_id: 'v_z',
        wall_type: 'interior',
        thickness_mm: 240,
        height_mm: 3000,
        material_type: 'brick',
      };
      document.walls.w_a = {
        start_vertex_id: 'v_a',
        end_vertex_id: 'v_a_anchor',
        wall_type: 'interior',
        thickness_mm: 240,
        height_mm: 3000,
        material_type: 'brick',
      };
      document.floors[0].wall_ids = ['w_z', 'w_a'];
      const context = createContext({ document });
      const started = reduceWallCommand(
        createIdleWallCommand(),
        { type: 'START', point: { x_mm: 0, y_mm: -1000 } },
        context,
      ).state;
      const moved = reduceWallCommand(
        started,
        {
          type: 'MOVE',
          point: { x_mm: 0, y_mm: 0 },
          constraint: 'free',
        },
        context,
      ).state;
      const first = reduceWallCommand(
        moved,
        { type: 'CONFIRM' },
        context,
      );
      const afterFirst = first.transaction!.apply(document);
      const firstState = first.transaction!.stateAfter(afterFirst);

      expect(firstState).toMatchObject({
        phase: 'idle',
        continuationAnchor: {
          point: points.v_a,
          vertexId: 'v_a',
        },
      });

      const nextContext = createContext({ document: afterFirst });
      const activated = reduceWallCommand(
        firstState,
        { type: 'ACTIVATE_CONTINUATION' },
        nextContext,
      ).state;
      const nextMoved = reduceWallCommand(
        activated,
        {
          type: 'MOVE',
          point: { x_mm: 1, y_mm: 1000 },
          constraint: 'orthogonal',
        },
        nextContext,
      ).state;
      const second = reduceWallCommand(
        nextMoved,
        { type: 'CONFIRM' },
        nextContext,
      );
      const afterSecond = second.transaction!.apply(afterFirst);
      const continuedWall = Object.values(afterSecond.walls).find((wall) => {
        const end = afterSecond.vertices[wall.end_vertex_id];
        return end.x_mm === 1 && end.y_mm === 1000;
      });

      expect(continuedWall?.start_vertex_id).toBe('v_a');
    },
  );

  it('keeps the canonical endpoint as an idle continuation anchor', () => {
    const context = createContext();
    const drawing = startAndMove();
    const withInput = reduceWallCommand(
      drawing,
      { type: 'INPUT', value: '2' },
      context,
    ).state;
    const committed = reduceWallCommand(
      withInput,
      { type: 'CONFIRM' },
      context,
    );

    expect(committed.state).toMatchObject({
      phase: 'idle',
      continuationAnchor: {
        point: { x_mm: 3000, y_mm: 1000 },
        vertexId: expect.any(String),
      },
    });
  });

  it('activates a single continuation from an idle anchor without a click', () => {
    const context = createContext();
    const anchor = {
      point: { x_mm: 3000, y_mm: 1000 },
      vertexId: 'v_2',
    };
    const activated = reduceWallCommand(
      { phase: 'idle', continuationAnchor: anchor },
      { type: 'ACTIVATE_CONTINUATION' },
      context,
    );

    expect(activated.state).toMatchObject({
      phase: 'drawing',
      mode: 'single',
      start: anchor,
      input: '',
    });
  });

  it('ignores continuation activation when there is no anchor', () => {
    const idle = createIdleWallCommand();
    expect(
      reduceWallCommand(
        idle,
        { type: 'ACTIVATE_CONTINUATION' },
        createContext(),
      ).state,
    ).toEqual(idle);
  });

  it('starts a normal wall at the clicked point instead of the old anchor', () => {
    const started = reduceWallCommand(
      {
        phase: 'idle',
        continuationAnchor: {
          point: { x_mm: 3000, y_mm: 1000 },
          vertexId: 'v_old',
        },
      },
      { type: 'START', point: { x_mm: 8000, y_mm: 9000 } },
      createContext(),
    );

    expect(started.state).toMatchObject({
      phase: 'drawing',
      mode: 'single',
      start: { point: { x_mm: 8000, y_mm: 9000 } },
    });
  });

  it('anchors to the topology-normalized endpoint and vertex id', () => {
    const document = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
    document.vertices.v_target = { x_mm: 3001, y_mm: 1000 };
    const context = createContext({ document });

    const committed = reduceWallCommand(
      startAndMove(context),
      { type: 'CONFIRM' },
      context,
    );

    expect(committed.state).toEqual({
      phase: 'idle',
      continuationAnchor: {
        point: { x_mm: 3001, y_mm: 1000 },
        vertexId: 'v_target',
      },
      lastSegment: { dxMm: 2001, dyMm: 0 },
    });
  });

  it('can activate and commit continuation repeatedly with a shared vertex', () => {
    const initialContext = createContext();
    const first = reduceWallCommand(
      startAndMove(initialContext),
      { type: 'CONFIRM' },
      initialContext,
    );
    const afterFirst = first.transaction!.apply(initialContext.document!);
    const nextContext = createContext({ document: afterFirst });
    const activated = reduceWallCommand(
      first.state,
      { type: 'ACTIVATE_CONTINUATION' },
      nextContext,
    ).state;
    const moved = reduceWallCommand(
      activated,
      {
        type: 'MOVE',
        point: { x_mm: 3000, y_mm: 3000 },
        constraint: 'orthogonal',
      },
      nextContext,
    ).state;
    const second = reduceWallCommand(
      moved,
      { type: 'CONFIRM' },
      nextContext,
    );
    const afterSecond = second.transaction!.apply(afterFirst);
    const walls = Object.values(afterSecond.walls);

    expect(walls).toHaveLength(2);
    expect(walls[0].end_vertex_id).toBe(walls[1].start_vertex_id);
    expect(second.state).toMatchObject({
      phase: 'idle',
      continuationAnchor: {
        point: { x_mm: 3000, y_mm: 3000 },
        vertexId: walls[1].end_vertex_id,
      },
    });
  });

  it('duplicates the last wall vector from its canonical endpoint', () => {
    const firstContext = createContext();
    const first = reduceWallCommand(
      startAndMove(firstContext),
      { type: 'CONFIRM' },
      firstContext,
    );
    const afterFirst = first.transaction!.apply(firstContext.document!);
    const firstState = first.transaction!.stateAfter(afterFirst);
    const secondContext = createContext({ document: afterFirst });
    const duplicated = reduceWallCommand(
      firstState,
      { type: 'DUPLICATE_LAST' },
      secondContext,
    );
    expect(duplicated.transaction).not.toBeNull();
    const afterSecond = duplicated.transaction!.apply(afterFirst);
    const walls = Object.values(afterSecond.walls);
    expect(walls).toHaveLength(2);
    const firstStart = afterSecond.vertices[walls[0].start_vertex_id];
    const firstEnd = afterSecond.vertices[walls[0].end_vertex_id];
    const secondStart = afterSecond.vertices[walls[1].start_vertex_id];
    const secondEnd = afterSecond.vertices[walls[1].end_vertex_id];
    expect(secondStart).toEqual(firstEnd);
    expect({
      x_mm: secondEnd.x_mm - secondStart.x_mm,
      y_mm: secondEnd.y_mm - secondStart.y_mm,
    }).toEqual({
      x_mm: firstEnd.x_mm - firstStart.x_mm,
      y_mm: firstEnd.y_mm - firstStart.y_mm,
    });
  });

  it('continues immediately after every polyline segment', () => {
    const context = createContext({ polyline: true });
    const first = reduceWallCommand(
      startAndMove(context),
      { type: 'CONFIRM' },
      context,
    );

    expect(first.state).toMatchObject({
      phase: 'drawing',
      mode: 'polyline',
      start: {
        point: { x_mm: 3000, y_mm: 1000 },
        vertexId: expect.any(String),
      },
      input: '',
    });
  });

  it('clears a continuation anchor on cancel', () => {
    const cancelled = reduceWallCommand(
      {
        phase: 'idle',
        continuationAnchor: {
          point: { x_mm: 3000, y_mm: 1000 },
          vertexId: 'v_2',
        },
      },
      { type: 'CANCEL' },
      createContext(),
    );
    expect(cancelled.state).toEqual({ phase: 'idle' });
  });

  it('cancels the active command with Escape semantics', () => {
    const cancelled = reduceWallCommand(
      startAndMove(),
      { type: 'CANCEL' },
      createContext(),
    );
    expect(cancelled).toEqual({
      state: { phase: 'idle' },
      transaction: null,
      error: null,
    });
  });

  it('does not commit an invalid or too-short typed length', () => {
    const context = createContext();
    const drawing = reduceWallCommand(
      startAndMove(),
      { type: 'INPUT', value: '0.05' },
      context,
    ).state;
    const result = reduceWallCommand(
      drawing,
      { type: 'CONFIRM' },
      context,
    );

    expect(result.transaction).toBeNull();
    expect(result.error).toBe('墙体长度不能小于 0.10 m');
    expect(result.state.phase).toBe('drawing');
  });

  it('returns a Chinese topology error without a transaction', () => {
    const document: BuildingDocument = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
    document.vertices = {
      v_1: { x_mm: 1000, y_mm: 1000 },
      v_2: { x_mm: 3000, y_mm: 1000 },
    };
    document.walls.w_1 = {
      start_vertex_id: 'v_1',
      end_vertex_id: 'v_2',
      wall_type: 'exterior',
      thickness_mm: 370,
      height_mm: 3000,
      material_type: 'brick',
    };
    document.floors[0].wall_ids = ['w_1'];
    const context = createContext({ document });

    const committed = reduceWallCommand(
      startAndMove(),
      { type: 'CONFIRM' },
      context,
    );

    expect(committed.transaction).toBeNull();
    expect(committed.error).toContain('重复');
    expect(committed.state.phase).toBe('drawing');
  });

  it('keeps a polyline drawing unchanged when topology insertion fails', () => {
    const document: BuildingDocument = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
    document.vertices = {
      v_1: { x_mm: 1000, y_mm: 1000 },
      v_2: { x_mm: 3000, y_mm: 1000 },
    };
    document.walls.w_1 = {
      start_vertex_id: 'v_1',
      end_vertex_id: 'v_2',
      wall_type: 'exterior',
      thickness_mm: 370,
      height_mm: 3000,
      material_type: 'brick',
    };
    document.floors[0].wall_ids = ['w_1'];
    const context = createContext({ document, polyline: true });
    const drawing = startAndMove(context);

    const failed = reduceWallCommand(
      drawing,
      { type: 'CONFIRM' },
      context,
    );

    expect(failed.transaction).toBeNull();
    expect(failed.state).toEqual(drawing);
    expect(context.document).toBe(document);
  });
});
