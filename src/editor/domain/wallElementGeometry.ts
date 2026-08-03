// ============================================================
// 墙上构件（门窗/洞口）绘制几何 — 客户端与服务端共用
// 单位统一为毫米 (mm)
// ============================================================

import type {
  BuildingDocument,
  BuildingVertex,
} from './buildingTypes.ts';

export interface WallElementRect {
  /** 矩形四角（沿墙方向 [offset, offset+width]，垂直方向 ±halfDepth） */
  corners: BuildingVertex[];
  /** 墙方向单位向量 */
  ux: number;
  uy: number;
  /** 墙法线（+n = 方向左侧，即 (-uy, ux)） */
  nx: number;
  ny: number;
  /** 垂直方向半深度 = 墙厚一半（最小 80mm 保证可见） */
  halfDepth: number;
}

/**
 * 构件矩形几何：沿墙方向从 offset_mm 到 offset_mm + width_mm，
 * 垂直方向 ± max(wall.thickness_mm, 80) / 2，与墙体宽度一致。
 */
export function wallElementRect(
  start: BuildingVertex,
  end: BuildingVertex,
  offsetMm: number,
  widthMm: number,
  thicknessMm: number,
): WallElementRect {
  const dx = end.x_mm - start.x_mm;
  const dy = end.y_mm - start.y_mm;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const halfDepth = Math.max(thicknessMm, 80) / 2;
  const halfWidth = widthMm / 2;
  const centerX = start.x_mm + ux * (offsetMm + halfWidth);
  const centerY = start.y_mm + uy * (offsetMm + halfWidth);
  const corners = [
    {
      x_mm: centerX - ux * halfWidth - nx * halfDepth,
      y_mm: centerY - uy * halfWidth - ny * halfDepth,
    },
    {
      x_mm: centerX + ux * halfWidth - nx * halfDepth,
      y_mm: centerY + uy * halfWidth - ny * halfDepth,
    },
    {
      x_mm: centerX + ux * halfWidth + nx * halfDepth,
      y_mm: centerY + uy * halfWidth + ny * halfDepth,
    },
    {
      x_mm: centerX - ux * halfWidth + nx * halfDepth,
      y_mm: centerY - uy * halfWidth + ny * halfDepth,
    },
  ];
  return { corners, ux, uy, nx, ny, halfDepth };
}

/**
 * 外门/外窗的室外侧判定：返回应乘在 +法线（(-uy, ux)，墙方向左侧）上的符号，
 * 使门弧/开启方向朝室外。依据 relations 中室内面（from_face_id）的重心位于墙
 * 方向的哪一侧，室外即其另一侧。无法判定时返回 null（调用方回退到默认侧）。
 */
export function exteriorSideSign(
  document: BuildingDocument,
  elementId: string,
): -1 | 1 | null {
  const element = document.wall_elements[elementId];
  if (!element) return null;
  const wall = document.walls[element.host_wall_id];
  if (!wall) return null;
  const start = document.vertices[wall.start_vertex_id];
  const end = document.vertices[wall.end_vertex_id];
  if (!start || !end) return null;
  const relation = document.relations.find(
    (item) => item.wall_element_id === elementId,
  );
  // 外门/外窗的关系方向为 室内面 → outside
  if (!relation || relation.to.kind !== 'outside') return null;
  const face = document.faces[relation.from_face_id];
  if (!face) return null;
  const points = face.boundary_vertex_ids
    .map((id) => document.vertices[id])
    .filter((point): point is BuildingVertex => Boolean(point));
  if (points.length < 3) return null;
  const centroidX =
    points.reduce((sum, point) => sum + point.x_mm, 0) / points.length;
  const centroidY =
    points.reduce((sum, point) => sum + point.y_mm, 0) / points.length;
  const dx = end.x_mm - start.x_mm;
  const dy = end.y_mm - start.y_mm;
  const cross = dx * (centroidY - start.y_mm) - dy * (centroidX - start.x_mm);
  if (cross === 0) return null;
  // cross > 0 → 室内面在墙方向左侧（+法线），室外在右侧 → 符号 -1
  return cross > 0 ? -1 : 1;
}
