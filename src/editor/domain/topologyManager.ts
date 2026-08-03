// ============================================================
// 拓扑管理器 — 墙体创建后的拓扑维护
//
// 当新墙体创建后，自动执行：
// 1. 检查终点是否落在已有墙中间 → T形拆分
// 2. 检查新墙是否与已有墙交叉 → 十字拆分
// 3. 拆分后门窗重归属
// ============================================================

import type { PlanDocument, Wall, Opening } from './planTypes.ts';
import { generateId } from './ids.ts';
import { projectPointToSegment, segmentIntersection } from './geometry.ts';
import { SNAP_TOLERANCE } from './constants.ts';
import { splitWallAtPoint } from './wallTopology.ts';

export interface TopologyActionResult {
  /** 需要添加到文档的新顶点 */
  newVertices: Array<{ id: string; x_cm: number; y_cm: number }>;
  /** 需要删除的墙ID */
  wallsToRemove: string[];
  /** 需要新添加的墙 */
  newWalls: Array<{
    id: string;
    start_vertex_id: string;
    end_vertex_id: string;
    wall_type: string;
    thickness_cm: number;
    height_cm: number;
    material_type: string;
    review_status: string;
  }>;
  /** 需要更新的门窗宿主信息 */
  openingUpdates: Array<{
    openingId: string;
    newHostWallId: string;
    newOffset: number;
  }>;
}

/**
 * 处理新建墙体后的拓扑维护
 */
export function processNewWallTopology(
  newWallId: string,
  newWall: Wall,
  doc: PlanDocument,
  snapMode: string,
): TopologyActionResult {
  const result: TopologyActionResult = {
    newVertices: [],
    wallsToRemove: [],
    newWalls: [],
    openingUpdates: [],
  };

  const startV = doc.vertices[newWall.start_vertex_id];
  const endV = doc.vertices[newWall.end_vertex_id];
  if (!startV || !endV) return result;

  const tolerance = SNAP_TOLERANCE[snapMode as keyof typeof SNAP_TOLERANCE] || 12;

  // 收集受影响的门窗
  const openingsOnWall = (wallId: string): Record<string, Opening> => {
    const ops: Record<string, Opening> = {};
    for (const [id, op] of Object.entries(doc.openings)) {
      if (op.host_wall_id === wallId) ops[id] = op;
    }
    return ops;
  };

  // Step 1: 检查终点是否落在已有墙中间（T形连接）
  for (const [existingId, existingWall] of Object.entries(doc.walls)) {
    if (existingId === newWallId) continue;

    const exStart = doc.vertices[existingWall.start_vertex_id];
    const exEnd = doc.vertices[existingWall.end_vertex_id];
    if (!exStart || !exEnd) continue;

    // 检查新墙终点是否在已有墙上
    const endProj = projectPointToSegment(
      endV.x_cm, endV.y_cm,
      exStart.x_cm, exStart.y_cm,
      exEnd.x_cm, exEnd.y_cm,
    );

    if (endProj.dist <= tolerance && endProj.t > 0.01 && endProj.t < 0.99) {
      // 新墙终点落在已有墙中间 → T形拆分
      const splitVertexId = generateId('v');
      const newAId = generateId('w');
      const newBId = generateId('w');

      const splitResult = splitWallAtPoint(
        existingWall,
        existingId,
        Math.round(endProj.x), Math.round(endProj.y),
        splitVertexId,
        newAId, newBId,
        exStart, exEnd,
        openingsOnWall(existingId),
      );

      result.newVertices.push({
        id: splitVertexId,
        x_cm: Math.round(endProj.x),
        y_cm: Math.round(endProj.y),
      });

      result.wallsToRemove.push(splitResult.originalWallId);

      result.newWalls.push({
        id: splitResult.newWallA.wallId,
        start_vertex_id: splitResult.newWallA.startVertexId,
        end_vertex_id: splitResult.newWallA.endVertexId,
        wall_type: existingWall.wall_type,
        thickness_cm: existingWall.thickness_cm,
        height_cm: existingWall.height_cm,
        material_type: existingWall.material_type,
        review_status: existingWall.review_status,
      });

      result.newWalls.push({
        id: splitResult.newWallB.wallId,
        start_vertex_id: splitResult.newWallB.startVertexId,
        end_vertex_id: splitResult.newWallB.endVertexId,
        wall_type: existingWall.wall_type,
        thickness_cm: existingWall.thickness_cm,
        height_cm: existingWall.height_cm,
        material_type: existingWall.material_type,
        review_status: existingWall.review_status,
      });

      // 门窗重归属
      for (const ao of splitResult.affectedOpenings) {
        result.openingUpdates.push({
          openingId: ao.openingId,
          newHostWallId: ao.offsetFromStartCm <= endProj.t * distance(exStart, exEnd)
            ? newAId : newBId,
          newOffset: ao.offsetFromStartCm <= endProj.t * distance(exStart, exEnd)
            ? ao.offsetFromStartCm
            : ao.offsetFromStartCm - endProj.t * distance(exStart, exEnd),
        });
      }

    }
  }

  // Step 2: 检查新墙是否与已有墙十字交叉
  // （简化实现：只检查不共线的交叉）
  for (const [existingId, existingWall] of Object.entries(doc.walls)) {
    if (existingId === newWallId) continue;
    if (result.wallsToRemove.includes(existingId)) continue;

    const exStart = doc.vertices[existingWall.start_vertex_id];
    const exEnd = doc.vertices[existingWall.end_vertex_id];
    if (!exStart || !exEnd) continue;

    const inter = segmentIntersection(
      startV.x_cm, startV.y_cm, endV.x_cm, endV.y_cm,
      exStart.x_cm, exStart.y_cm, exEnd.x_cm, exEnd.y_cm,
    );

    if (inter.intersects &&
        inter.t1 > 0.01 && inter.t1 < 0.99 &&
        inter.t2 > 0.01 && inter.t2 < 0.99) {

      const splitVertexId = generateId('v');
      const newVertId = splitVertexId;

      result.newVertices.push({
        id: newVertId,
        x_cm: Math.round(inter.x),
        y_cm: Math.round(inter.y),
      });

      // 拆分新墙（当前墙）
      const newWallAId = generateId('w');
      const newWallBId = generateId('w');
      result.wallsToRemove.push(newWallId);

      result.newWalls.push({
        id: newWallAId,
        start_vertex_id: newWall.start_vertex_id,
        end_vertex_id: newVertId,
        wall_type: newWall.wall_type,
        thickness_cm: newWall.thickness_cm,
        height_cm: newWall.height_cm,
        material_type: newWall.material_type,
        review_status: newWall.review_status,
      });
      result.newWalls.push({
        id: newWallBId,
        start_vertex_id: newVertId,
        end_vertex_id: newWall.end_vertex_id,
        wall_type: newWall.wall_type,
        thickness_cm: newWall.thickness_cm,
        height_cm: newWall.height_cm,
        material_type: newWall.material_type,
        review_status: newWall.review_status,
      });

      // 拆分已有墙
      const exNewAId = generateId('w');
      const exNewBId = generateId('w');
      result.wallsToRemove.push(existingId);

      result.newWalls.push({
        id: exNewAId,
        start_vertex_id: existingWall.start_vertex_id,
        end_vertex_id: newVertId,
        wall_type: existingWall.wall_type,
        thickness_cm: existingWall.thickness_cm,
        height_cm: existingWall.height_cm,
        material_type: existingWall.material_type,
        review_status: existingWall.review_status,
      });
      result.newWalls.push({
        id: exNewBId,
        start_vertex_id: newVertId,
        end_vertex_id: existingWall.end_vertex_id,
        wall_type: existingWall.wall_type,
        thickness_cm: existingWall.thickness_cm,
        height_cm: existingWall.height_cm,
        material_type: existingWall.material_type,
        review_status: existingWall.review_status,
      });

      // 已有墙上的门窗重归属
      const exWallLen = Math.sqrt(
        (exEnd.x_cm - exStart.x_cm) ** 2 + (exEnd.y_cm - exStart.y_cm) ** 2,
      );
      const splitDist = inter.t2 * exWallLen;

      for (const [opId, op] of Object.entries(openingsOnWall(existingId))) {
        if (op.offset_from_start_cm <= splitDist) {
          result.openingUpdates.push({
            openingId: opId,
            newHostWallId: exNewAId,
            newOffset: op.offset_from_start_cm,
          });
        } else {
          result.openingUpdates.push({
            openingId: opId,
            newHostWallId: exNewBId,
            newOffset: op.offset_from_start_cm - splitDist,
          });
        }
      }
    }
  }

  return result;
}

function distance(a: { x_cm: number; y_cm: number }, b: { x_cm: number; y_cm: number }): number {
  return Math.sqrt((b.x_cm - a.x_cm) ** 2 + (b.y_cm - a.y_cm) ** 2);
}
