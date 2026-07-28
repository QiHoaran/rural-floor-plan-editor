// ============================================================
// 吸附模块 — 网格吸附和顶点吸附
// ============================================================

import type { SnapMode } from './planTypes.ts';
import {
  MAJOR_GRID_STEP_CM,
  MINOR_GRID_STEP_CM,
  FINE_STEP_CM,
  SNAP_TOLERANCE,
} from './constants.ts';

/**
 * 将坐标吸附到最近的网格点
 *
 * @param value 原始坐标值（cm）
 * @param step 吸附步长（cm）
 * @returns 吸附后的坐标值
 */
export function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * 根据吸附模式吸附坐标
 */
export function snapCoordinate(value: number, mode: SnapMode): number {
  switch (mode) {
    case 'major':
      return snapToGrid(value, MAJOR_GRID_STEP_CM);
    case 'minor':
      return snapToGrid(value, MINOR_GRID_STEP_CM);
    case 'fine':
      return snapToGrid(value, FINE_STEP_CM);
    case 'none':
      return value;
  }
}

/**
 * 吸附坐标对
 */
export function snapCoordinatePair(
  x_cm: number,
  y_cm: number,
  mode: SnapMode,
): [number, number] {
  return [snapCoordinate(x_cm, mode), snapCoordinate(y_cm, mode)];
}

/**
 * 判断两个坐标值是否在容差范围内
 */
export function isWithinTolerance(a: number, b: number, toleranceCm: number = 1): boolean {
  return Math.abs(a - b) <= toleranceCm;
}

/**
 * 从候选顶点中查找最近的顶点
 * 如果距离小于容差则返回该顶点ID和坐标
 */
export function findNearestVertex(
  x_cm: number,
  y_cm: number,
  vertices: Record<string, { x_cm: number; y_cm: number }>,
  mode: SnapMode,
): { vertexId: string; x_cm: number; y_cm: number } | null {
  const tolerance = SNAP_TOLERANCE[mode];

  let nearestId: string | null = null;
  let nearestDist = Infinity;
  let nearestX = 0;
  let nearestY = 0;

  for (const [id, v] of Object.entries(vertices)) {
    const dx = v.x_cm - x_cm;
    const dy = v.y_cm - y_cm;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= tolerance && dist < nearestDist) {
      nearestId = id;
      nearestDist = dist;
      nearestX = v.x_cm;
      nearestY = v.y_cm;
    }
  }

  if (nearestId) {
    return { vertexId: nearestId, x_cm: nearestX, y_cm: nearestY };
  }
  return null;
}

/**
 * 查找落在已有墙上的投影点
 * 如果新墙的终点投影到某条已有墙上且距离小于容差，返回投影信息
 */
export function findWallProjection(
  x_cm: number,
  y_cm: number,
  walls: Record<string, { start_vertex_id: string; end_vertex_id: string }>,
  vertices: Record<string, { x_cm: number; y_cm: number }>,
  wallIdsToExclude: string[],
  tolerance: number,
): {
  wallId: string;
  splitPointX: number;
  splitPointY: number;
  t: number; // 投影参数
} | null {
  let bestResult: {
    wallId: string;
    splitPointX: number;
    splitPointY: number;
    t: number;
  } | null = null;
  let bestDist = tolerance;

  for (const [wallId, wall] of Object.entries(walls)) {
    if (wallIdsToExclude.includes(wallId)) continue;

    const startV = vertices[wall.start_vertex_id];
    const endV = vertices[wall.end_vertex_id];
    if (!startV || !endV) continue;

    // 计算点到线段的投影
    const dx = endV.x_cm - startV.x_cm;
    const dy = endV.y_cm - startV.y_cm;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;

    let t = ((x_cm - startV.x_cm) * dx + (y_cm - startV.y_cm) * dy) / lenSq;

    // 排除端点附近的投影（应该走顶点吸附）
    if (t < 0.01 || t > 0.99) continue;

    const projX = startV.x_cm + t * dx;
    const projY = startV.y_cm + t * dy;
    const dist = Math.sqrt((projX - x_cm) ** 2 + (projY - y_cm) ** 2);

    if (dist < bestDist) {
      bestDist = dist;
      bestResult = {
        wallId,
        splitPointX: projX,
        splitPointY: projY,
        t,
      };
    }
  }

  return bestResult;
}
