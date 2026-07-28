// ============================================================
// 门窗几何计算 — 位置、归属、越界检测
// ============================================================

import type { Opening, Vertex, Wall } from './planTypes.ts';
import { distance, projectPointToSegment } from './geometry.ts';

/**
 * 门窗在墙体上的位置参数
 */
export interface OpeningPosition {
  /** 门窗中心点坐标 [x_cm, y_cm] */
  center: [number, number];
  /** 门窗左端点坐标 [x_cm, y_cm] */
  startPoint: [number, number];
  /** 门窗右端点坐标 [x_cm, y_cm] */
  endPoint: [number, number];
  /** 墙体方向角度（度） */
  wallAngle: number;
  /** 门窗宽度在墙上的实际长度（cm） */
  actualWidth: number;
}

/**
 * 计算门窗在墙上的位置
 *
 * 约定：offset_from_start_cm 是门窗中心到墙起点的距离
 * 当准备将门窗放置在墙体上时，传入 offset_cm = 目标中心点沿墙的距离
 *
 * center = wallStart + unitDirection * offset
 * startPoint = center - unitDirection * width / 2
 * endPoint = center + unitDirection * width / 2
 */
export function calculateOpeningPosition(
  startVertex: Vertex,
  endVertex: Vertex,
  offsetFromStartCm: number,
  widthCm: number,
): OpeningPosition {
  const dx = endVertex.x_cm - startVertex.x_cm;
  const dy = endVertex.y_cm - startVertex.y_cm;
  const wallLength = Math.sqrt(dx * dx + dy * dy);

  if (wallLength === 0) {
    return {
      center: [startVertex.x_cm, startVertex.y_cm],
      startPoint: [startVertex.x_cm, startVertex.y_cm],
      endPoint: [startVertex.x_cm, startVertex.y_cm],
      wallAngle: 0,
      actualWidth: 0,
    };
  }

  // 单位方向向量
  const ux = dx / wallLength;
  const uy = dy / wallLength;

  // 中心点
  const cx = startVertex.x_cm + ux * offsetFromStartCm;
  const cy = startVertex.y_cm + uy * offsetFromStartCm;

  // 左右端点
  const halfW = widthCm / 2;
  const sx = cx - ux * halfW;
  const sy = cy - uy * halfW;
  const ex = cx + ux * halfW;
  const ey = cy + uy * halfW;

  // 墙体角度
  const wallAngle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;

  return {
    center: [cx, cy],
    startPoint: [sx, sy],
    endPoint: [ex, ey],
    wallAngle,
    actualWidth: widthCm,
  };
}

/**
 * 查找离鼠标最近的墙体
 * 返回墙体ID、投影点和偏移量
 */
export function findNearestWall(
  x_cm: number,
  y_cm: number,
  walls: Record<string, Wall>,
  vertices: Record<string, Vertex>,
  maxDistanceCm: number,
): {
  wallId: string;
  projectionX: number;
  projectionY: number;
  offsetFromStartCm: number;
  distanceCm: number;
} | null {
  let bestResult: {
    wallId: string;
    projectionX: number;
    projectionY: number;
    offsetFromStartCm: number;
    distanceCm: number;
  } | null = null;
  let bestDist = maxDistanceCm;

  for (const [wallId, wall] of Object.entries(walls)) {
    const startV = vertices[wall.start_vertex_id];
    const endV = vertices[wall.end_vertex_id];
    if (!startV || !endV) continue;

    const proj = projectPointToSegment(
      x_cm, y_cm,
      startV.x_cm, startV.y_cm,
      endV.x_cm, endV.y_cm,
    );

    if (proj.dist < bestDist) {
      const wallLen = distance(
        startV.x_cm, startV.y_cm,
        endV.x_cm, endV.y_cm,
      );
      bestDist = proj.dist;
      bestResult = {
        wallId,
        projectionX: proj.x,
        projectionY: proj.y,
        offsetFromStartCm: Math.round(proj.t * wallLen),
        distanceCm: Math.round(proj.dist),
      };
    }
  }

  return bestResult;
}

/**
 * 检查门窗是否在墙的有效范围内
 * 门窗整体必须在墙段内（不能超出端点）
 */
export function isOpeningWithinWall(
  startVertex: Vertex,
  endVertex: Vertex,
  offsetFromStartCm: number,
  widthCm: number,
): {
  valid: boolean;
  message?: string;
} {
  const wallLen = distance(
    startVertex.x_cm, startVertex.y_cm,
    endVertex.x_cm, endVertex.y_cm,
  );

  const halfW = widthCm / 2;
  const nearEnd = offsetFromStartCm - halfW;
  const farEnd = offsetFromStartCm + halfW;

  if (widthCm > wallLen) {
    return { valid: false, message: `门窗宽度(${widthCm}cm)超过墙长(${Math.round(wallLen)}cm)` };
  }

  if (nearEnd < 0) {
    return { valid: false, message: `门窗左侧超出墙体起点 ${Math.abs(Math.round(nearEnd))}cm` };
  }

  if (farEnd > wallLen) {
    return { valid: false, message: `门窗右侧超出墙体终点 ${Math.round(farEnd - wallLen)}cm` };
  }

  return { valid: true };
}

/**
 * 检查同一条墙上多个门窗是否重叠
 */
export function checkOpeningsOverlap(
  openings: { id: string; offset: number; width: number }[],
): { overlapped: boolean; pairs: [string, string][] } {
  const pairs: [string, string][] = [];

  for (let i = 0; i < openings.length; i++) {
    for (let j = i + 1; j < openings.length; j++) {
      const a = openings[i];
      const b = openings[j];

      const aStart = a.offset - a.width / 2;
      const aEnd = a.offset + a.width / 2;
      const bStart = b.offset - b.width / 2;
      const bEnd = b.offset + b.width / 2;

      // 检查区间是否重叠
      if (aStart < bEnd && bStart < aEnd) {
        pairs.push([a.id, b.id]);
      }
    }
  }

  return { overlapped: pairs.length > 0, pairs };
}

/**
 * 墙体拆分后的门窗重新归属
 *
 * 当原墙被拆分为两段时，需要根据门窗offset判断属于哪段新墙
 */
export function reassignOpeningAfterSplit(
  opening: Opening,
  _originalWallLengthCm: number,
  splitTCm: number, // 分割点在原墙上的距离（从起点算起）
  newWallAId: string,
  newWallALengthCm: number,
  newWallBId: string,
  newWallBLengthCm: number,
): { newHostWallId: string; newOffset: number } | null {
  const offset = opening.offset_from_start_cm;

  if (offset <= splitTCm) {
    // 属于前段墙
    // 确保门窗整体在前段范围内
    const halfW = opening.width_cm / 2;
    if (offset + halfW > newWallALengthCm) {
      // 门窗超出前段墙范围，无法归属
      return null;
    }
    return { newHostWallId: newWallAId, newOffset: offset };
  } else {
    // 属于后段墙
    const newOffset = offset - splitTCm;
    const halfW = opening.width_cm / 2;
    if (newOffset - halfW < 0) {
      // 门窗超出后段墙范围（起始方向），无法归属
      return null;
    }
    if (newOffset + halfW > newWallBLengthCm) {
      return null;
    }
    return { newHostWallId: newWallBId, newOffset };
  }
}

/**
 * 墙体删除后的孤立门窗检查
 */
export function findOrphanedOpenings(
  deletedWallIds: Set<string>,
  openings: Record<string, Opening>,
): string[] {
  const orphaned: string[] = [];
  for (const [opId, opening] of Object.entries(openings)) {
    if (deletedWallIds.has(opening.host_wall_id)) {
      orphaned.push(opId);
    }
  }
  return orphaned;
}

/**
 * 墙体长度变化后门窗的越界检查
 */
export function checkOpeningsAfterWallResize(
  openings: Array<{ id: string; offset: number; width: number }>,
  newWallLengthCm: number,
): Array<{ id: string; offset: number; width: number; issue: string }> {
  const issues: Array<{ id: string; offset: number; width: number; issue: string }> = [];

  for (const op of openings) {
    const halfW = op.width / 2;
    if (op.offset + halfW > newWallLengthCm) {
      issues.push({
        ...op,
        issue: `门窗右侧超出墙端 ${Math.round(op.offset + halfW - newWallLengthCm)}cm`,
      });
    }
    if (op.offset - halfW < 0) {
      issues.push({
        ...op,
        issue: `门窗左侧超出墙端 ${Math.round(-(op.offset - halfW))}cm`,
      });
    }
  }

  return issues;
}
