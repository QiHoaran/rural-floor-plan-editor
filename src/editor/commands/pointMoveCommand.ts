import type {
  BuildingDocument,
  BuildingVertex,
} from '../domain/buildingTypes.ts';
import {
  normalizeGraph,
  type InsertWallFailureCode,
} from '../topology/normalizeGraph.ts';
import { recomputeGeometry } from '../domain/recomputeGeometry.ts';

export type PointMoveErrorCode =
  | 'VERTEX_MISSING'
  | 'COORDINATE_NON_FINITE'
  | 'COORDINATE_UNSAFE'
  | 'COORDINATE_NON_INTEGER'
  | InsertWallFailureCode
  | 'ELEMENT_HOST_MISSING'
  | 'ELEMENT_OUT_OF_BOUNDS'
  | 'ELEMENT_OVERLAP';

export type PointMoveResult =
  | { ok: true; document: BuildingDocument; vertexId: string }
  | { ok: false; code: PointMoveErrorCode; message: string };

const TOPOLOGY_MESSAGES: Record<InsertWallFailureCode, string> = {
  ZERO_LENGTH: '移动失败：墙体长度不能为零',
  DUPLICATE_EDGE: '移动失败：产生了重复墙体',
  COLLINEAR_OVERLAP: '移动失败：产生了共线重叠墙体',
  ELEMENT_SPANS_SPLIT: '移动失败：墙上构件跨越了拆分点',
};

const ELEMENT_MESSAGES = {
  ELEMENT_HOST_MISSING: '移动失败：墙上构件的宿主墙不存在',
  ELEMENT_OUT_OF_BOUNDS: '移动失败：墙缩短后构件超出有效范围',
  ELEMENT_OVERLAP: '移动失败：墙上构件发生重叠',
} as const;

export function moveVertex(
  document: BuildingDocument,
  vertexId: string,
  target: BuildingVertex,
): PointMoveResult {
  if (!document.vertices[vertexId]) {
    return error('VERTEX_MISSING', '移动失败：顶点不存在');
  }
  if (!Number.isFinite(target.x_mm) || !Number.isFinite(target.y_mm)) {
    return error('COORDINATE_NON_FINITE', '坐标必须是有限数字');
  }
  if (
    !Number.isSafeInteger(target.x_mm) ||
    !Number.isSafeInteger(target.y_mm)
  ) {
    const code =
      Number.isInteger(target.x_mm) && Number.isInteger(target.y_mm)
        ? 'COORDINATE_UNSAFE'
        : 'COORDINATE_NON_INTEGER';
    return error(
      code,
      code === 'COORDINATE_UNSAFE'
        ? '坐标必须是安全整数'
        : '坐标必须是整数毫米',
    );
  }
  const original = document.vertices[vertexId];
  if (original.x_mm === target.x_mm && original.y_mm === target.y_mm) {
    return { ok: true, document, vertexId };
  }

  const candidate = structuredClone(document);
  candidate.vertices[vertexId] = { ...target };
  const topology = normalizeGraph(candidate);
  if (!topology.ok) {
    return error(topology.code, TOPOLOGY_MESSAGES[topology.code]);
  }
  const canonicalVertexId = topology.canonicalVertexIds?.[vertexId];
  if (!canonicalVertexId || !topology.document.vertices[canonicalVertexId]) {
    return error('VERTEX_MISSING', '移动失败：无法确定规范顶点');
  }
  const recomputed = recomputeGeometry(topology.document);
  if (!recomputed.ok) {
    return error(recomputed.code, ELEMENT_MESSAGES[recomputed.code]);
  }
  return {
    ok: true,
    document: recomputed.document,
    vertexId: canonicalVertexId,
  };
}

export type DeleteVertexResult =
  | { ok: true; document: BuildingDocument }
  | {
      ok: false;
      code: 'VERTEX_MISSING' | 'VERTEX_CONNECTED';
      message: string;
    };

export function deleteVertex(
  document: BuildingDocument,
  vertexId: string,
): DeleteVertexResult {
  if (!document.vertices[vertexId]) {
    return error('VERTEX_MISSING', '删除失败：顶点不存在');
  }
  const connected = Object.values(document.walls).some(
    (wall) =>
      wall.start_vertex_id === vertexId ||
      wall.end_vertex_id === vertexId,
  );
  if (connected) {
    return error('VERTEX_CONNECTED', '该顶点连接着墙体，不能删除');
  }
  const next = structuredClone(document);
  delete next.vertices[vertexId];
  return { ok: true, document: next };
}

function error<C extends string>(
  code: C,
  message: string,
): { ok: false; code: C; message: string } {
  return { ok: false, code, message };
}
