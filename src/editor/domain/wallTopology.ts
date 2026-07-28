// ============================================================
// 墙体拓扑操作 — T形连接、十字连接、墙体拆分
// ============================================================

import type { Wall, Vertex, Opening } from './planTypes.ts';
import { distance, projectPointToSegment, segmentIntersection } from './geometry.ts';

/**
 * 墙体拆分结果
 */
export interface WallSplitResult {
  /** 被拆分的原墙ID（将被删除） */
  originalWallId: string;
  /** 新建的顶点ID（交点/投影点） */
  newVertexId: string;
  /** 拆分后产生的两段新墙 */
  newWallA: {
    wallId: string;
    startVertexId: string;
    endVertexId: string;
  };
  newWallB: {
    wallId: string;
    startVertexId: string;
    endVertexId: string;
  };
  /** 新顶点的坐标 */
  splitPoint: { x_cm: number; y_cm: number };
  /** 需要重新分配宿主的门窗列表 */
  affectedOpenings: { openingId: string; oldWallId: string; offsetFromStartCm: number }[];
}

/**
 * 当新墙终点落在已有墙中间时，拆分已有墙
 *
 * 场景：T形连接 — 新墙的终点落在已有墙的中间
 */
export function splitWallAtPoint(
  wallToSplit: Wall,
  wallId: string,
  splitX: number,
  splitY: number,
  newVertexId: string,
  newWallAId: string,
  newWallBId: string,
  startVertex: Vertex,
  endVertex: Vertex,
  openingsOnWall: Record<string, Opening>,
): WallSplitResult {
  const affectedOpenings: WallSplitResult['affectedOpenings'] = [];

  // 计算分割点在原墙上的t值（比例）
  const proj = projectPointToSegment(
    splitX, splitY,
    startVertex.x_cm, startVertex.y_cm,
    endVertex.x_cm, endVertex.y_cm,
  );

  const t = proj.t;
  const splitLength = distance(
    startVertex.x_cm, startVertex.y_cm,
    endVertex.x_cm, endVertex.y_cm,
  );

  // 确定门窗归属
  for (const [opId, opening] of Object.entries(openingsOnWall)) {
    // 门窗中心到墙起点的距离
    const offsetCm = opening.offset_from_start_cm;

    if (offsetCm <= t * splitLength) {
      // 门窗属于前段墙（newWallA），offset不变
      affectedOpenings.push({
        openingId: opId,
        oldWallId: wallId,
        offsetFromStartCm: offsetCm,
      });
    } else {
      // 门窗属于后段墙（newWallB），offset减去前段长度
      affectedOpenings.push({
        openingId: opId,
        oldWallId: wallId,
        offsetFromStartCm: offsetCm - t * splitLength,
      });
    }
  }

  return {
    originalWallId: wallId,
    newVertexId,
    newWallA: {
      wallId: newWallAId,
      startVertexId: wallToSplit.start_vertex_id,
      endVertexId: newVertexId,
    },
    newWallB: {
      wallId: newWallBId,
      startVertexId: newVertexId,
      endVertexId: wallToSplit.end_vertex_id,
    },
    splitPoint: { x_cm: splitX, y_cm: splitY },
    affectedOpenings,
  };
}

/**
 * 十字连接：两条墙相交，两者都要拆分
 */
export function crossIntersection(
  wallA: Wall,
  wallAId: string,
  wallB: Wall,
  wallBId: string,
  startA: Vertex,
  endA: Vertex,
  startB: Vertex,
  endB: Vertex,
  newVertexId: string,
  newWallA1Id: string,
  newWallA2Id: string,
  newWallB1Id: string,
  newWallB2Id: string,
): {
  resultA: WallSplitResult;
  resultB: WallSplitResult;
  intersectionPoint: { x_cm: number; y_cm: number };
} {
  const inter = segmentIntersection(
    startA.x_cm, startA.y_cm, endA.x_cm, endA.y_cm,
    startB.x_cm, startB.y_cm, endB.x_cm, endB.y_cm,
  );

  if (!inter.intersects) {
    throw new Error('Walls do not intersect');
  }

  const splitX = inter.x;
  const splitY = inter.y;

  // 先拆分墙A（使用空门窗列表，因为拆分结果中的门窗归属需要合并处理）
  const resultA: WallSplitResult = {
    originalWallId: wallAId,
    newVertexId,
    newWallA: {
      wallId: newWallA1Id,
      startVertexId: wallA.start_vertex_id,
      endVertexId: newVertexId,
    },
    newWallB: {
      wallId: newWallA2Id,
      startVertexId: newVertexId,
      endVertexId: wallA.end_vertex_id,
    },
    splitPoint: { x_cm: Math.round(splitX), y_cm: Math.round(splitY) },
    affectedOpenings: [],
  };

  // 拆分墙B
  const resultB: WallSplitResult = {
    originalWallId: wallBId,
    newVertexId,
    newWallA: {
      wallId: newWallB1Id,
      startVertexId: wallB.start_vertex_id,
      endVertexId: newVertexId,
    },
    newWallB: {
      wallId: newWallB2Id,
      startVertexId: newVertexId,
      endVertexId: wallB.end_vertex_id,
    },
    splitPoint: { x_cm: Math.round(splitX), y_cm: Math.round(splitY) },
    affectedOpenings: [],
  };

  return {
    resultA,
    resultB,
    intersectionPoint: { x_cm: Math.round(splitX), y_cm: Math.round(splitY) },
  };
}

/**
 * 合并近似顶点
 * 检查所有顶点对，将距离小于容差的合并
 * 返回顶点合并映射
 */
export function mergeNearbyVertices(
  vertices: Record<string, Vertex>,
  walls: Record<string, Wall>,
  toleranceCm: number,
): {
  mergedVertices: Record<string, Vertex>;
  mergedWalls: Record<string, Wall>;
  mergeMap: Record<string, string>; // 被合并的ID → 保留的ID
} {
  const entries = Object.entries(vertices);
  const mergeMap: Record<string, string> = {};
  const merged: Record<string, Vertex> = {};
  const processed = new Set<string>();

  // 构建合并映射
  for (let i = 0; i < entries.length; i++) {
    const [idA, vA] = entries[i];
    if (processed.has(idA)) continue;

    let keepId = idA;
    let keepV = vA;

    for (let j = i + 1; j < entries.length; j++) {
      const [idB, vB] = entries[j];
      if (processed.has(idB)) continue;

      const dist = distance(keepV.x_cm, keepV.y_cm, vB.x_cm, vB.y_cm);
      if (dist <= toleranceCm) {
        // 合并到 keepId
        mergeMap[idB] = keepId;
        processed.add(idB);
      }
    }

    merged[keepId] = keepV;
    processed.add(keepId);
  }

  // 更新墙体引用
  const updatedWalls: Record<string, Wall> = {};
  for (const [wallId, wall] of Object.entries(walls)) {
    updatedWalls[wallId] = {
      ...wall,
      start_vertex_id: mergeMap[wall.start_vertex_id] || wall.start_vertex_id,
      end_vertex_id: mergeMap[wall.end_vertex_id] || wall.end_vertex_id,
    };
  }

  return {
    mergedVertices: merged,
    mergedWalls: updatedWalls,
    mergeMap,
  };
}

/**
 * 检查墙体是否连接（共享顶点）
 */
export function areWallsConnected(
  wallA: Wall,
  wallB: Wall,
): boolean {
  return (
    wallA.start_vertex_id === wallB.start_vertex_id ||
    wallA.start_vertex_id === wallB.end_vertex_id ||
    wallA.end_vertex_id === wallB.start_vertex_id ||
    wallA.end_vertex_id === wallB.end_vertex_id
  );
}

/**
 * 获取墙体在连接节点处的共享顶点ID
 */
export function getSharedVertexId(
  wallA: Wall,
  wallB: Wall,
): string | null {
  const ids = new Set([
    wallA.start_vertex_id,
    wallA.end_vertex_id,
  ]);

  if (ids.has(wallB.start_vertex_id)) return wallB.start_vertex_id;
  if (ids.has(wallB.end_vertex_id)) return wallB.end_vertex_id;

  return null;
}

/**
 * 从墙体邻接关系构建无向图
 * 返回邻接表: vertexId → Set<wallId>
 */
export function buildWallAdjacency(
  walls: Record<string, Wall>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  for (const [wallId, wall] of Object.entries(walls)) {
    for (const vId of [wall.start_vertex_id, wall.end_vertex_id]) {
      if (!adj.has(vId)) {
        adj.set(vId, new Set());
      }
      adj.get(vId)!.add(wallId);
    }
  }

  return adj;
}
