// ============================================================
// 墙体几何计算 — 长度、角度、Polygon生成
// ============================================================

import type { Wall, Vertex } from './planTypes.ts';
import { distance, angleDeg } from './geometry.ts';

/**
 * 计算墙长（cm）
 */
export function wallLengthCm(
  startVertex: Vertex,
  endVertex: Vertex,
): number {
  return Math.round(distance(startVertex.x_cm, startVertex.y_cm, endVertex.x_cm, endVertex.y_cm));
}

/**
 * 计算墙角度（度）
 * 0° = 水平向右，逆时针为正
 */
export function wallAngleDeg(startVertex: Vertex, endVertex: Vertex): number {
  return angleDeg(startVertex.x_cm, startVertex.y_cm, endVertex.x_cm, endVertex.y_cm);
}

/**
 * 判断墙是否水平（在容差范围内）
 */
export function isHorizontal(startVertex: Vertex, endVertex: Vertex, toleranceDeg: number = 3): boolean {
  const angle = wallAngleDeg(startVertex, endVertex);
  return Math.abs(angle) < toleranceDeg || Math.abs(angle - 180) < toleranceDeg;
}

/**
 * 判断墙是否垂直（在容差范围内）
 */
export function isVertical(startVertex: Vertex, endVertex: Vertex, toleranceDeg: number = 3): boolean {
  const angle = wallAngleDeg(startVertex, endVertex);
  return Math.abs(angle - 90) < toleranceDeg || Math.abs(angle - 270) < toleranceDeg;
}

/**
 * 从起点沿方向延伸指定长度得到终点坐标
 */
export function extendFromStart(
  startVertex: Vertex,
  lengthCm: number,
  angleDeg: number,
): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const endX = Math.round(startVertex.x_cm + lengthCm * Math.cos(rad));
  const endY = Math.round(startVertex.y_cm + lengthCm * Math.sin(rad));
  return [endX, endY];
}

/**
 * 从终点沿相反方向延伸指定长度得到起点坐标
 */
export function extendFromEnd(
  endVertex: Vertex,
  lengthCm: number,
  angleDeg: number,
): [number, number] {
  const rad = ((angleDeg + 180) * Math.PI) / 180;
  const startX = Math.round(endVertex.x_cm + lengthCm * Math.cos(rad));
  const startY = Math.round(endVertex.y_cm + lengthCm * Math.sin(rad));
  return [startX, startY];
}

/**
 * 从中心点向两端延伸得到新的起点和终点坐标
 */
export function extendFromMidpoint(
  startVertex: Vertex,
  endVertex: Vertex,
  newLengthCm: number,
): [number, number, number, number] {
  const midX = Math.round((startVertex.x_cm + endVertex.x_cm) / 2);
  const midY = Math.round((startVertex.y_cm + endVertex.y_cm) / 2);
  const angle = wallAngleDeg(startVertex, endVertex);
  const halfLength = Math.round(newLengthCm / 2);
  const rad = (angle * Math.PI) / 180;

  const newStartX = Math.round(midX - halfLength * Math.cos(rad));
  const newStartY = Math.round(midY - halfLength * Math.sin(rad));
  const newEndX = Math.round(midX + halfLength * Math.cos(rad));
  const newEndY = Math.round(midY + halfLength * Math.sin(rad));

  return [newStartX, newStartY, newEndX, newEndY];
}

/**
 * 为单个墙段生成简化墙体面（偏移多边形）
 *
 * 对中心线的两侧各偏移 thickness_cm / 2
 * 返回四个顶点坐标（矩形），格式为 [x_cm, y_cm][]
 *
 * 注意：这是简化版本，不处理miter join
 * 后续可以使用后端Shapely做精确buffer
 */
export function generateSimpleWallPolygon(
  startVertex: Vertex,
  endVertex: Vertex,
  thicknessCm: number,
): [number, number][] {
  const dx = endVertex.x_cm - startVertex.x_cm;
  const dy = endVertex.y_cm - startVertex.y_cm;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return [];

  // 单位法向量
  const nx = (-dy / len) * (thicknessCm / 2);
  const ny = (dx / len) * (thicknessCm / 2);

  // 四个角
  const p1: [number, number] = [
    Math.round((startVertex.x_cm + nx) * 2) / 2,
    Math.round((startVertex.y_cm + ny) * 2) / 2,
  ];
  const p2: [number, number] = [
    Math.round((endVertex.x_cm + nx) * 2) / 2,
    Math.round((endVertex.y_cm + ny) * 2) / 2,
  ];
  const p3: [number, number] = [
    Math.round((endVertex.x_cm - nx) * 2) / 2,
    Math.round((endVertex.y_cm - ny) * 2) / 2,
  ];
  const p4: [number, number] = [
    Math.round((startVertex.x_cm - nx) * 2) / 2,
    Math.round((startVertex.y_cm - ny) * 2) / 2,
  ];

  return [p1, p2, p3, p4];
}

/**
 * 根据墙长更新方式获取新的顶点坐标
 */
export function calculateNewEndpoints(
  _wall: Wall,
  startVertex: Vertex,
  endVertex: Vertex,
  newLengthCm: number,
  anchor: 'start' | 'end' | 'midpoint',
): { newStartX: number; newStartY: number; newEndX: number; newEndY: number } {
  const angle = wallAngleDeg(startVertex, endVertex);

  switch (anchor) {
    case 'start':
      return {
        newStartX: startVertex.x_cm,
        newStartY: startVertex.y_cm,
        newEndX: extendFromStart(startVertex, newLengthCm, angle)[0],
        newEndY: extendFromStart(startVertex, newLengthCm, angle)[1],
      };
    case 'end':
      return {
        newStartX: extendFromEnd(endVertex, newLengthCm, angle)[0],
        newStartY: extendFromEnd(endVertex, newLengthCm, angle)[1],
        newEndX: endVertex.x_cm,
        newEndY: endVertex.y_cm,
      };
    case 'midpoint': {
      const [nsx, nsy, nex, ney] = extendFromMidpoint(startVertex, endVertex, newLengthCm);
      return { newStartX: nsx, newStartY: nsy, newEndX: nex, newEndY: ney };
    }
  }
}

/**
 * 判断两条墙是否近似平行且重叠（重复墙检测）
 */
export function areWallsOverlapping(
  w1Start: Vertex,
  w1End: Vertex,
  w2Start: Vertex,
  w2End: Vertex,
  thicknessCm: number,
  toleranceCm: number = 5,
): boolean {
  // 检查方向是否近似平行
  const angle1 = wallAngleDeg(w1Start, w1End);
  const angle2 = wallAngleDeg(w2Start, w2End);
  const angleDiff = Math.abs(angle1 - angle2);

  if (angleDiff > toleranceCm && Math.abs(angleDiff - 180) > toleranceCm) {
    return false;
  }

  // 检查是否在同一条直线上（法线距离）
  const dx = w1End.x_cm - w1Start.x_cm;
  const dy = w1End.y_cm - w1Start.y_cm;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return false;

  // 计算 w2Start 到 w1 线段的法线距离
  const nx = -dy / len;
  const ny = dx / len;
  const dist = Math.abs((w2Start.x_cm - w1Start.x_cm) * nx + (w2Start.y_cm - w1Start.y_cm) * ny);

  // 法线距离小于厚度和容差则认为重叠
  return dist < thicknessCm + toleranceCm;
}

/**
 * 墙体面的合并简化版本（用于房间检测）
 * 将多个独立墙段的面合并为一个多边形
 *
 * 注意：这是简化实现，复杂户型建议用后端Shapely
 */
export function mergeWallPolygons(polygons: [number, number][][]): [number, number][] | null {
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return polygons[0];

  // 简化：直接返回第一个多边形
  // 完整实现在第二阶段或后端完成
  return polygons[0];
}
