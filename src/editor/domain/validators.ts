// ============================================================
// 校验器 — 墙体/门窗/房间/数据校验
// ============================================================

import type { PlanDocument, ValidationIssue } from './planTypes.ts';
import { wallLengthCm } from './wallGeometry.ts';
import { isOpeningWithinWall, checkOpeningsOverlap } from './openingGeometry.ts';
import { polygonArea } from './geometry.ts';
import { MIN_WALL_LENGTH_CM, MIN_ROOM_AREA_CM2 } from './constants.ts';

/**
 * 校验所有墙体
 */
function validateWalls(doc: PlanDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [wallId, wall] of Object.entries(doc.walls)) {
    // 起点终点不能相同
    if (wall.start_vertex_id === wall.end_vertex_id) {
      issues.push({
        level: 'error',
        code: 'WALL_SAME_VERTEX',
        message: `墙 ${wallId} 起点和终点相同`,
        entity_type: 'wall',
        entity_id: wallId,
      });
    }

    // 顶点存在性
    if (!doc.vertices[wall.start_vertex_id]) {
      issues.push({
        level: 'error',
        code: 'WALL_MISSING_START_VERTEX',
        message: `墙 ${wallId} 的起点顶点 ${wall.start_vertex_id} 不存在`,
        entity_type: 'wall',
        entity_id: wallId,
      });
    }
    if (!doc.vertices[wall.end_vertex_id]) {
      issues.push({
        level: 'error',
        code: 'WALL_MISSING_END_VERTEX',
        message: `墙 ${wallId} 的终点顶点 ${wall.end_vertex_id} 不存在`,
        entity_type: 'wall',
        entity_id: wallId,
      });
    }

    // 墙长大于最小值
    const startV = doc.vertices[wall.start_vertex_id];
    const endV = doc.vertices[wall.end_vertex_id];
    if (startV && endV) {
      const len = wallLengthCm(startV, endV);
      if (len < MIN_WALL_LENGTH_CM) {
        issues.push({
          level: 'warning',
          code: 'WALL_TOO_SHORT',
          message: `墙 ${wallId} 长度(${len}cm)小于最小值(${MIN_WALL_LENGTH_CM}cm)`,
          entity_type: 'wall',
          entity_id: wallId,
        });
      }
    }

    // 墙厚
    if (wall.thickness_cm <= 0) {
      issues.push({
        level: 'error',
        code: 'WALL_INVALID_THICKNESS',
        message: `墙 ${wallId} 墙厚无效: ${wall.thickness_cm}cm`,
        entity_type: 'wall',
        entity_id: wallId,
      });
    }
  }

  // 检查完全重复的墙
  const wallSet = new Set<string>();
  for (const [wallId, wall] of Object.entries(doc.walls)) {
    const key = [wall.start_vertex_id, wall.end_vertex_id].sort().join('|');
    if (wallSet.has(key)) {
      issues.push({
        level: 'warning',
        code: 'WALL_DUPLICATE',
        message: `墙 ${wallId} 与另一条墙顶点重复`,
        entity_type: 'wall',
        entity_id: wallId,
      });
    }
    wallSet.add(key);
  }

  return issues;
}

/**
 * 校验所有门窗
 */
function validateOpenings(doc: PlanDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [opId, opening] of Object.entries(doc.openings)) {
    // 宿主墙存在性
    if (!doc.walls[opening.host_wall_id]) {
      issues.push({
        level: 'error',
        code: 'OPENING_ORPHANED',
        message: `门窗 ${opId} 的宿主墙 ${opening.host_wall_id} 不存在（孤立门窗）`,
        entity_type: 'opening',
        entity_id: opId,
      });
      continue;
    }

    // 偏移范围
    const wall = doc.walls[opening.host_wall_id];
    const startV = doc.vertices[wall.start_vertex_id];
    const endV = doc.vertices[wall.end_vertex_id];
    if (startV && endV) {
      const check = isOpeningWithinWall(startV, endV, opening.offset_from_start_cm, opening.width_cm);
      if (!check.valid) {
        issues.push({
          level: 'error',
          code: 'OPENING_OUT_OF_BOUNDS',
          message: `门窗 ${opId}: ${check.message}`,
          entity_type: 'opening',
          entity_id: opId,
        });
      }
    }
  }

  // 同墙门窗重叠检查
  const openingsByWall = new Map<string, Array<{ id: string; offset: number; width: number }>>();
  for (const [opId, opening] of Object.entries(doc.openings)) {
    if (!doc.walls[opening.host_wall_id]) continue;
    if (!openingsByWall.has(opening.host_wall_id)) {
      openingsByWall.set(opening.host_wall_id, []);
    }
    openingsByWall.get(opening.host_wall_id)!.push({
      id: opId,
      offset: opening.offset_from_start_cm,
      width: opening.width_cm,
    });
  }

  for (const [wallId, ops] of openingsByWall.entries()) {
    if (ops.length <= 1) continue;
    const result = checkOpeningsOverlap(ops);
    if (result.overlapped) {
      for (const [a, b] of result.pairs) {
        issues.push({
          level: 'warning',
          code: 'OPENING_OVERLAP',
          message: `门窗 ${a} 与 ${b} 在墙 ${wallId} 上重叠`,
          entity_type: 'opening',
          entity_id: a,
        });
      }
    }
  }

  return issues;
}

/**
 * 校验所有房间
 */
function validateSpaces(doc: PlanDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [spaceId, space] of Object.entries(doc.spaces)) {
    if (space.generated_polygon && space.generated_polygon.length > 0) {
      const ring = space.generated_polygon[0];
      if (ring.length >= 3) {
        const area = polygonArea(ring);
        if (area < MIN_ROOM_AREA_CM2) {
          issues.push({
            level: 'warning',
            code: 'SPACE_TOO_SMALL',
            message: `房间 ${spaceId} 面积(${(area / 10000).toFixed(2)}m²)过小`,
            entity_type: 'space',
            entity_id: spaceId,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * 通用数据校验
 */
function validateData(doc: PlanDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 空项目检查
  if (Object.keys(doc.walls).length === 0 && Object.keys(doc.spaces).length === 0) {
    issues.push({
      level: 'info',
      code: 'PLAN_EMPTY',
      message: '项目尚无墙体或房间数据',
      entity_type: 'plan',
      entity_id: null,
    });
  }

  return issues;
}

/**
 * 完整校验
 */
export function validateAll(doc: PlanDocument): ValidationIssue[] {
  return [
    ...validateWalls(doc),
    ...validateOpenings(doc),
    ...validateSpaces(doc),
    ...validateData(doc),
  ];
}

/**
 * 检查是否可以通过审核（无error级别问题）
 */
export function canApprove(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.level === 'error');
}
