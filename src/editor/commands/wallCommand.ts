import type {
  BuildingDocument,
  BuildingVertex,
  BuildingWall,
} from '@/editor/domain/buildingTypes.ts';
import {
  constrainedDirection,
  endpointAtLength,
  type CadDirection,
  type DirectionConstraint,
} from '@/editor/domain/cadWall.ts';
import { parseMeters } from '@/editor/domain/cadInput.ts';
import { snapTypedEndpoint } from '@/editor/cad/snapEngine.ts';
import {
  insertWall,
  type InsertWallFailureCode,
  type WallCandidate,
} from '@/editor/topology/normalizeGraph.ts';
import { recomputeGeometry } from '@/editor/domain/recomputeGeometry.ts';

export interface CommandPoint {
  point: BuildingVertex;
  vertexId?: string;
}

export interface WallSegmentVector {
  dxMm: number;
  dyMm: number;
}

export type WallCommandState =
  | {
      phase: 'idle';
      continuationAnchor?: CommandPoint;
      lastSegment?: WallSegmentVector;
    }
  | {
      phase: 'drawing';
      mode: 'single' | 'polyline';
      continuation: boolean;
      start: CommandPoint;
      cursor: BuildingVertex;
      previewEnd: BuildingVertex;
      direction: CadDirection;
      angleDeg: number;
      input: string;
    };

export type WallCommandEvent =
  | { type: 'START'; point: BuildingVertex; vertexId?: string }
  | { type: 'ACTIVATE_CONTINUATION' }
  | {
      type: 'MOVE';
      point: BuildingVertex;
      constraint: DirectionConstraint;
    }
  | { type: 'INPUT'; value: string }
  | { type: 'DUPLICATE_LAST' }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL' };

export interface WallCommandContext {
  document: BuildingDocument | null;
  wallType: BuildingWall['wall_type'];
  polyline: boolean;
  wallThicknessMm: number;
  wallHeightMm: number;
  materialType: BuildingWall['material_type'];
  nextId: (kind: 'vertex' | 'wall') => string;
}

export interface BuildingTransaction {
  description: string;
  apply: (document: BuildingDocument) => BuildingDocument;
  stateAfter: (document: BuildingDocument) => WallCommandState;
}

export class WallTopologyTransactionError extends Error {
  readonly code: InsertWallFailureCode;

  constructor(code: InsertWallFailureCode) {
    super(topologyError(code));
    this.name = 'WallTopologyTransactionError';
    this.code = code;
  }
}

export interface WallCommandResult {
  state: WallCommandState;
  transaction: BuildingTransaction | null;
  error: string | null;
}

const MIN_WALL_LENGTH_MM = 100;

export function createIdleWallCommand(
  continuationAnchor?: CommandPoint,
  lastSegment?: WallSegmentVector,
): WallCommandState {
  return continuationAnchor
    ? {
        phase: 'idle',
        continuationAnchor,
        ...(lastSegment ? { lastSegment } : {}),
      }
    : { phase: 'idle' };
}

export function reduceWallCommand(
  state: WallCommandState,
  event: WallCommandEvent,
  context: WallCommandContext,
): WallCommandResult {
  if (event.type === 'CANCEL') {
    return result(createIdleWallCommand());
  }

  if (state.phase === 'idle') {
    if (
      event.type === 'DUPLICATE_LAST' &&
      state.continuationAnchor &&
      state.lastSegment
    ) {
      const { dxMm, dyMm } = state.lastSegment;
      const length = Math.hypot(dxMm, dyMm);
      if (length < MIN_WALL_LENGTH_MM) return result(state);
      const direction: CadDirection = {
        dx: dxMm / length,
        dy: dyMm / length,
        angle_deg: Math.atan2(dyMm, dxMm) * 180 / Math.PI,
      };
      return reduceWallCommand(
        {
          phase: 'drawing',
          mode: 'single',
          continuation: true,
          start: state.continuationAnchor,
          cursor: {
            x_mm: state.continuationAnchor.point.x_mm + dxMm,
            y_mm: state.continuationAnchor.point.y_mm + dyMm,
          },
          previewEnd: {
            x_mm: state.continuationAnchor.point.x_mm + dxMm,
            y_mm: state.continuationAnchor.point.y_mm + dyMm,
          },
          direction,
          angleDeg: direction.angle_deg,
          input: '',
        },
        { type: 'CONFIRM' },
        context,
      );
    }
    if (
      event.type === 'ACTIVATE_CONTINUATION' &&
      state.continuationAnchor
    ) {
      return result(
        drawingFrom(state.continuationAnchor, 'single', true),
      );
    }
    if (event.type !== 'START') return result(state);
    return result(
      drawingFrom(
        { point: event.point, vertexId: event.vertexId },
        context.polyline ? 'polyline' : 'single',
        false,
      ),
    );
  }

  if (event.type === 'START') {
    return result(state);
  }

  if (event.type === 'MOVE') {
    const direction = constrainedDirection(
      state.start.point,
      event.point,
      event.constraint,
    );
    const previewEnd = constrainPreviewEnd(
      state.start.point,
      event.point,
      direction,
      event.constraint,
    );
    return result({
      ...state,
      cursor: event.point,
      previewEnd,
      direction,
      angleDeg: direction.angle_deg,
    });
  }

  if (event.type === 'INPUT') {
    return result({ ...state, input: event.value });
  }

  if (event.type === 'CONFIRM') {
    if (!context.document) {
      return {
        state,
        transaction: null,
        error: '拓扑插入失败：建筑文档未加载',
      };
    }
    const endpointResult = resolveEndpoint(state, context.document);
    if (!endpointResult.ok) {
      return {
        state,
        transaction: null,
        error: endpointResult.message,
      };
    }

    const endpoint = endpointResult.endpoint;
    const candidate: WallCandidate = {
      start: state.start.point,
      end: endpoint.point,
      wall_type: context.wallType,
      thickness_mm: context.wallThicknessMm,
      height_mm: context.wallHeightMm,
      material_type: context.materialType,
      floor_id: context.document.floors[0]?.floor_id,
    };
    const topology = insertWall(context.document, candidate);
    if (!topology.ok) {
      return {
        state,
        transaction: null,
        error: topologyError(topology.code),
      };
    }
    let latestTopology = topology;
    const transaction: BuildingTransaction = {
      description:
        context.wallType === 'exterior' ? '绘制外墙' : '绘制内墙',
      apply: (document) => {
        latestTopology = applyWallCandidate(document, candidate);
        return latestTopology.document;
      },
      stateAfter: (document) => {
        if (latestTopology.document !== document) {
          throw new Error(
            '墙体事务状态必须基于最近一次实际应用结果',
          );
        }
        return nextStateAfterCommit(
          state,
          createdCandidateTerminal(
            document,
            latestTopology.createdWallIds,
          ),
        );
      },
    };

    return {
      state: nextStateAfterCommit(
        state,
        createdCandidateTerminal(
          topology.document,
          topology.createdWallIds,
        ),
      ),
      transaction,
      error: null,
    };
  }

  return result(state);
}

function applyWallCandidate(
  document: BuildingDocument,
  candidate: WallCandidate,
): Extract<ReturnType<typeof insertWall>, { ok: true }> {
  const topology = insertWall(document, candidate);
  if (!topology.ok) {
    throw new WallTopologyTransactionError(topology.code);
  }
  const recomputed = recomputeGeometry(topology.document);
  if (!recomputed.ok) {
    throw new WallTopologyTransactionError('ELEMENT_SPANS_SPLIT');
  }
  return { ...topology, document: recomputed.document };
}

function nextStateAfterCommit(
  state: Extract<WallCommandState, { phase: 'drawing' }>,
  canonicalEnd: CommandPoint,
): WallCommandState {
  return state.mode === 'polyline'
    ? {
        phase: 'drawing',
        mode: 'polyline',
        continuation: false,
        start: canonicalEnd,
        cursor: canonicalEnd.point,
        previewEnd: canonicalEnd.point,
        direction: state.direction,
        angleDeg: state.angleDeg,
        input: '',
      }
    : createIdleWallCommand(canonicalEnd, {
        dxMm: canonicalEnd.point.x_mm - state.start.point.x_mm,
        dyMm: canonicalEnd.point.y_mm - state.start.point.y_mm,
      });
}

function createdCandidateTerminal(
  document: BuildingDocument,
  createdWallIds: readonly string[],
): CommandPoint {
  const createdWalls = createdWallIds.map((wallId) => {
    const wall = document.walls[wallId];
    if (!wall) {
      throw new Error(`墙体事务结果缺少新建墙 ${wallId}`);
    }
    return wall;
  });
  const createdStartIds = new Set(
    createdWalls.map((wall) => wall.start_vertex_id),
  );
  const terminalWall = createdWalls.find(
    (wall) => !createdStartIds.has(wall.end_vertex_id),
  );
  if (!terminalWall) {
    throw new Error('墙体事务结果无法解析候选终点');
  }
  const vertexId = terminalWall.end_vertex_id;
  const point = document.vertices[vertexId];
  if (!point) {
    throw new Error(`墙体事务结果缺少终点 ${vertexId}`);
  }
  return { point, vertexId };
}

function drawingFrom(
  start: CommandPoint,
  mode: 'single' | 'polyline',
  continuation: boolean,
): Extract<WallCommandState, { phase: 'drawing' }> {
  const direction: CadDirection = { dx: 1, dy: 0, angle_deg: 0 };
  return {
    phase: 'drawing',
    mode,
    continuation,
    start,
    cursor: start.point,
    previewEnd: start.point,
    direction,
    angleDeg: 0,
    input: '',
  };
}

function resolveEndpoint(
  state: Extract<WallCommandState, { phase: 'drawing' }>,
  document: BuildingDocument,
):
  | { ok: true; endpoint: CommandPoint }
  | { ok: false; message: string } {
  if (state.input.trim()) {
    const parsed = parseMeters(state.input, MIN_WALL_LENGTH_MM);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      endpoint: snapTypedEndpoint(
        document,
        endpointAtLength(
          state.start.point,
          state.direction,
          parsed.millimeters,
        ),
      ),
    };
  }

  const length = Math.hypot(
    state.previewEnd.x_mm - state.start.point.x_mm,
    state.previewEnd.y_mm - state.start.point.y_mm,
  );
  if (length < MIN_WALL_LENGTH_MM) {
    return {
      ok: false,
      message: '墙体长度不能小于 0.10 m',
    };
  }
  return { ok: true, endpoint: { point: state.previewEnd } };
}

function topologyError(code: InsertWallFailureCode): string {
  switch (code) {
    case 'ZERO_LENGTH':
      return '拓扑插入失败：墙体长度为零';
    case 'DUPLICATE_EDGE':
      return '拓扑插入失败：墙体与已有墙重复';
    case 'ELEMENT_SPANS_SPLIT':
      return '拓扑插入失败：墙上构件跨越了新的分割点';
    case 'COLLINEAR_OVERLAP':
      return '拓扑插入失败：墙体与已有墙共线重叠';
  }
}

function constrainPreviewEnd(
  start: BuildingVertex,
  cursor: BuildingVertex,
  direction: CadDirection,
  constraint: DirectionConstraint,
): BuildingVertex {
  if (constraint === 'free') {
    return {
      x_mm: Math.round(cursor.x_mm),
      y_mm: Math.round(cursor.y_mm),
    };
  }
  if (constraint === 'orthogonal') {
    return direction.dx === 0
      ? { x_mm: start.x_mm, y_mm: Math.round(cursor.y_mm) }
      : { x_mm: Math.round(cursor.x_mm), y_mm: start.y_mm };
  }

  const rawX = cursor.x_mm - start.x_mm;
  const rawY = cursor.y_mm - start.y_mm;
  const projectedLength = Math.max(
    0,
    rawX * direction.dx + rawY * direction.dy,
  );
  return endpointAtLength(
    start,
    direction,
    Math.round(projectedLength),
  );
}

function result(state: WallCommandState): WallCommandResult {
  return { state, transaction: null, error: null };
}
