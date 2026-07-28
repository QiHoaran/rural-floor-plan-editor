// ============================================================
// Store 选择器 — 派生状态计算
// ============================================================

import type { PlanDocument, Vertex, Opening } from '@/editor/domain/planTypes.ts';
import { wallLengthCm, wallAngleDeg } from '@/editor/domain/wallGeometry.ts';
import { calculateOpeningPosition } from '@/editor/domain/openingGeometry.ts';

/**
 * 获取指定墙体的长度
 */
export function selectWallLength(doc: PlanDocument, wallId: string): number | null {
  const wall = doc.walls[wallId];
  if (!wall) return null;
  const startV = doc.vertices[wall.start_vertex_id];
  const endV = doc.vertices[wall.end_vertex_id];
  if (!startV || !endV) return null;
  return wallLengthCm(startV, endV);
}

/**
 * 获取指定墙体的角度
 */
export function selectWallAngle(doc: PlanDocument, wallId: string): number | null {
  const wall = doc.walls[wallId];
  if (!wall) return null;
  const startV = doc.vertices[wall.start_vertex_id];
  const endV = doc.vertices[wall.end_vertex_id];
  if (!startV || !endV) return null;
  return wallAngleDeg(startV, endV);
}

/**
 * 获取墙体的顶点对
 */
export function selectWallVertices(
  doc: PlanDocument,
  wallId: string,
): { start: Vertex | null; end: Vertex | null } {
  const wall = doc.walls[wallId];
  if (!wall) return { start: null, end: null };
  return {
    start: doc.vertices[wall.start_vertex_id] ?? null,
    end: doc.vertices[wall.end_vertex_id] ?? null,
  };
}

/**
 * 获取指定墙上的所有门窗
 */
export function selectOpeningsOnWall(
  doc: PlanDocument,
  wallId: string,
): Array<{ id: string; opening: Opening }> {
  const result: Array<{ id: string; opening: Opening }> = [];
  for (const [id, opening] of Object.entries(doc.openings)) {
    if (opening.host_wall_id === wallId) {
      result.push({ id, opening });
    }
  }
  return result;
}

/**
 * 获取门窗的显示位置
 */
export function selectOpeningPosition(
  doc: PlanDocument,
  openingId: string,
) {
  const opening = doc.openings[openingId];
  if (!opening) return null;
  const wall = doc.walls[opening.host_wall_id];
  if (!wall) return null;
  const startV = doc.vertices[wall.start_vertex_id];
  const endV = doc.vertices[wall.end_vertex_id];
  if (!startV || !endV) return null;

  return calculateOpeningPosition(
    startV,
    endV,
    opening.offset_from_start_cm,
    opening.width_cm,
  );
}

/**
 * 获取所有墙体的ID列表
 */
export function selectAllWallIds(doc: PlanDocument): string[] {
  return Object.keys(doc.walls);
}

/**
 * 获取所有孤立的门窗（宿主墙已删除）
 */
export function selectOrphanedOpenings(doc: PlanDocument): Array<{ id: string; opening: Opening }> {
  const result: Array<{ id: string; opening: Opening }> = [];
  for (const [id, opening] of Object.entries(doc.openings)) {
    if (!doc.walls[opening.host_wall_id]) {
      result.push({ id, opening });
    }
  }
  return result;
}

/**
 * 统计房间数量
 */
export function selectSpaceCount(doc: PlanDocument): number {
  return Object.keys(doc.spaces).length;
}

/**
 * 统计错误和警告数量
 */
export function selectIssueCounts(doc: PlanDocument): { errors: number; warnings: number; infos: number } {
  return {
    errors: doc.validation.errors.length,
    warnings: doc.validation.warnings.length,
    infos: doc.validation.infos.length,
  };
}

/**
 * 获取默认墙厚（根据墙类型）
 */
export function selectDefaultThicknessForType(
  doc: PlanDocument,
  wallType: string,
): number {
  switch (wallType) {
    case 'exterior':
      return doc.defaults.exterior_wall_thickness_cm;
    case 'interior':
      return doc.defaults.interior_wall_thickness_cm;
    default:
      return doc.defaults.wall_thickness_cm;
  }
}
