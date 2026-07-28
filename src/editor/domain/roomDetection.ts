// ============================================================
// 房间自动检测 — 基于墙中心线闭合区域检测
//
// MVP版本使用简化方法：
// 1. 找到所有墙的外包矩形
// 2. 根据水平/垂直分割墙将建筑划分为房间
// 3. 生成近似矩形房间
//
// 完整版本（未来）：使用平面图拓扑的精确polygonization
// ============================================================

import type { PlanDocument, Space } from './planTypes.ts';
import { polygonArea } from './geometry.ts';
import { generateId } from './ids.ts';
import { MIN_ROOM_AREA_CM2 } from './constants.ts';

/**
 * 检测房间（主入口函数）
 */
export function detectRooms(doc: PlanDocument): Record<string, Space> {
  return simpleRoomDetection(doc);
}

/**
 * 简化房间检测算法：
 * 1. 找到建筑外包矩形
 * 2. 找到内部水平墙作为分割线
 * 3. 生成矩形房间
 *
 * 适用于正交布局的乡村住宅
 */
function simpleRoomDetection(doc: PlanDocument): Record<string, Space> {
  const spaces: Record<string, Space> = {};
  const verts = doc.vertices;

  // 收集所有墙端点坐标
  const allPoints: [number, number][] = [];
  const horizontalWalls: Array<{ y: number; x1: number; x2: number }> = [];
  const verticalWalls: Array<{ x: number; y1: number; y2: number }> = [];

  for (const wall of Object.values(doc.walls)) {
    const sv = verts[wall.start_vertex_id];
    const ev = verts[wall.end_vertex_id];
    if (!sv || !ev) continue;

    allPoints.push([sv.x_cm, sv.y_cm]);
    allPoints.push([ev.x_cm, ev.y_cm]);

    // 检测水平墙 (y坐标差小于容差)
    if (Math.abs(sv.y_cm - ev.y_cm) < 20) {
      horizontalWalls.push({
        y: Math.round((sv.y_cm + ev.y_cm) / 2),
        x1: Math.min(sv.x_cm, ev.x_cm),
        x2: Math.max(sv.x_cm, ev.x_cm),
      });
    }

    // 检测垂直墙 (x坐标差小于容差)
    if (Math.abs(sv.x_cm - ev.x_cm) < 20) {
      verticalWalls.push({
        x: Math.round((sv.x_cm + ev.x_cm) / 2),
        y1: Math.min(sv.y_cm, ev.y_cm),
        y2: Math.max(sv.y_cm, ev.y_cm),
      });
    }
  }

  if (allPoints.length < 4) return spaces;

  // 计算外包矩形
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of allPoints) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // 建筑太小
  if (maxX - minX < 100 || maxY - minY < 100) return spaces;

  // 按Y收集水平分割线（内部墙）
  const yDividers = new Set<number>();
  for (const hw of horizontalWalls) {
    // 排除外墙边缘
    if (hw.y > minY + 20 && hw.y < maxY - 20) {
      yDividers.add(hw.y);
    }
  }

  // 按X收集垂直分割线
  const xDividers = new Set<number>();
  for (const vw of verticalWalls) {
    if (vw.x > minX + 20 && vw.x < maxX - 20) {
      xDividers.add(vw.x);
    }
  }

  // 生成分割网格
  const yLevels = [minY, ...Array.from(yDividers).sort((a, b) => a - b), maxY];
  const xLevels = [minX, ...Array.from(xDividers).sort((a, b) => a - b), maxX];

  // 生成房间
  for (let yi = 0; yi < yLevels.length - 1; yi++) {
    for (let xi = 0; xi < xLevels.length - 1; xi++) {
      const x1 = xLevels[xi];
      const x2 = xLevels[xi + 1];
      const y1 = yLevels[yi];
      const y2 = yLevels[yi + 1];

      const width = x2 - x1;
      const height = y2 - y1;
      if (width < 50 || height < 50) continue;

      const poly: [number, number][] = [
        [x1, y1], [x2, y1], [x2, y2], [x1, y2],
      ];

      const area = polygonArea(poly);
      if (area < MIN_ROOM_AREA_CM2) continue;

      const spaceId = generateId('r');
      spaces[spaceId] = {
        room_type: 'unknown',
        local_name: '',
        generated_polygon: [poly],
        source: 'derived_from_walls',
        review_status: 'draft',
        confidence: xDividers.size > 0 || yDividers.size > 0 ? 'medium' : 'low',
        heated: false,
      };
    }
  }

  // 如果没有分割墙，整个建筑作为一个房间
  if (Object.keys(spaces).length === 0) {
    const spaceId = generateId('r');
    const poly: [number, number][] = [
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
    ];
    const area = polygonArea(poly);
    if (area >= MIN_ROOM_AREA_CM2) {
      spaces[spaceId] = {
        room_type: 'unknown',
        local_name: '',
        generated_polygon: [poly],
        source: 'derived_from_walls',
        review_status: 'draft',
        confidence: 'low',
        heated: false,
      };
    }
  }

  return spaces;
}

/**
 * 重新检测并更新房间
 */
export function regenerateRooms(doc: PlanDocument): Record<string, Space> {
  return detectRooms(doc);
}
