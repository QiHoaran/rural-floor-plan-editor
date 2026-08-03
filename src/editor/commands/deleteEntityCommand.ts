// ============================================================
// 删除实体命令 — v2.1.0
// 支持删除顶点、墙体（线）、墙体构件、房间面，并级联清理关联数据
// ============================================================

import type {
  BuildingDocument,
} from '../domain/buildingTypes.ts';
import type { EditorEntityType } from '../store/editorStore.ts';
import { recomputeGeometry } from '../domain/recomputeGeometry.ts';

export type DeleteEntityErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'VERTEX_CONNECTED'
  | 'FACE_HAS_RELATIONS';

export type DeleteEntityResult =
  | { ok: true; document: BuildingDocument }
  | {
      ok: false;
      code: DeleteEntityErrorCode;
      message: string;
    };

/**
 * 删除指定类型的实体，自动级联清理：
 * - 删除墙体时：同时删除其上所有构件及相关关系
 * - 删除构件时：同时删除相关关系
 * - 删除面时：同时删除相关关系，更新楼层索引
 * - 删除顶点时：仅当顶点未被任何墙体引用
 */
export function deleteEntity(
  document: BuildingDocument,
  entityType: EditorEntityType,
  entityId: string,
): DeleteEntityResult {
  switch (entityType) {
    case 'vertex':
      return deleteVertexEntity(document, entityId);
    case 'wall':
      return deleteWallEntity(document, entityId);
    case 'wall_element':
      return deleteWallElementEntity(document, entityId);
    case 'face':
      return deleteFaceEntity(document, entityId);
    case 'outside_region':
      return deleteOutsideRegionEntity(document, entityId);
    default:
      return {
        ok: false,
        code: 'ENTITY_NOT_FOUND',
        message: `不支持的实体类型: ${entityType}`,
      };
  }
}

// ---- 删除顶点 ----

function deleteVertexEntity(
  document: BuildingDocument,
  vertexId: string,
): DeleteEntityResult {
  if (!document.vertices[vertexId]) {
    return err('ENTITY_NOT_FOUND', '删除失败：顶点不存在');
  }

  // 检查是否被墙体引用
  const connectedToWalls = Object.values(document.walls).some(
    (wall) =>
      wall.start_vertex_id === vertexId || wall.end_vertex_id === vertexId,
  );
  if (connectedToWalls) {
    return err(
      'VERTEX_CONNECTED',
      '该顶点连接着墙体，请先删除相关墙体后再删除顶点',
    );
  }

  const next = structuredClone(document);
  delete next.vertices[vertexId];

  // 清理面片边界中的引用
  for (const faceId of Object.keys(next.faces)) {
    next.faces[faceId] = {
      ...next.faces[faceId],
      boundary_vertex_ids: next.faces[faceId].boundary_vertex_ids.filter(
        (id) => id !== vertexId,
      ),
    };
  }

  // 清理室外区域边界中的引用
  for (const regionId of Object.keys(next.outside_regions)) {
    next.outside_regions[regionId] = {
      ...next.outside_regions[regionId],
      boundary_vertex_ids:
        next.outside_regions[regionId].boundary_vertex_ids.filter(
          (id) => id !== vertexId,
        ),
    };
  }

  return { ok: true, document: next };
}

// ---- 删除墙体（含级联清理构件和关系） ----

function deleteWallEntity(
  document: BuildingDocument,
  wallId: string,
): DeleteEntityResult {
  if (!document.walls[wallId]) {
    return err('ENTITY_NOT_FOUND', '删除失败：墙体不存在');
  }

  const next = structuredClone(document);

  // 1. 找到该墙体上的所有构件
  const hostedElementIds = Object.entries(next.wall_elements)
    .filter(([, el]) => el.host_wall_id === wallId)
    .map(([id]) => id);

  // 2. 删除这些构件
  for (const elementId of hostedElementIds) {
    delete next.wall_elements[elementId];
  }

  // 3. 删除相关关系
  next.relations = next.relations.filter(
    (rel) => !hostedElementIds.includes(rel.wall_element_id),
  );

  // 4. 删除墙体本身
  delete next.walls[wallId];

  // 5. 更新楼层 wall_ids
  for (const floor of next.floors) {
    floor.wall_ids = floor.wall_ids.filter((id) => id !== wallId);
  }

  // 6. 清理孤立顶点（只被该墙体引用且无其他引用）
  const remainingVertexIds = new Set<string>();
  for (const wall of Object.values(next.walls)) {
    remainingVertexIds.add(wall.start_vertex_id);
    remainingVertexIds.add(wall.end_vertex_id);
  }
  for (const face of Object.values(next.faces)) {
    for (const vid of face.boundary_vertex_ids) {
      remainingVertexIds.add(vid);
    }
  }
  for (const region of Object.values(next.outside_regions)) {
    for (const vid of region.boundary_vertex_ids) {
      remainingVertexIds.add(vid);
    }
  }

  const deletedWall = document.walls[wallId];
  for (const vid of [deletedWall.start_vertex_id, deletedWall.end_vertex_id]) {
    if (!remainingVertexIds.has(vid) && next.vertices[vid]) {
      delete next.vertices[vid];
    }
  }

  // 7. 重新计算几何（面片可能变化）
  const recomputed = recomputeGeometry(next);
  if (!recomputed.ok) {
    // 几何重算失败也返回文档（面片可能暂时悬空，后续由 normalize 修复）
    return { ok: true, document: next };
  }

  return { ok: true, document: recomputed.document };
}

// ---- 删除墙体构件 ----

function deleteWallElementEntity(
  document: BuildingDocument,
  elementId: string,
): DeleteEntityResult {
  if (!document.wall_elements[elementId]) {
    return err('ENTITY_NOT_FOUND', '删除失败：构件不存在');
  }

  const next = structuredClone(document);

  // 1. 删除构件
  delete next.wall_elements[elementId];

  // 2. 删除相关关系
  next.relations = next.relations.filter(
    (rel) => rel.wall_element_id !== elementId,
  );

  return { ok: true, document: next };
}

// ---- 删除房间面 ----

function deleteFaceEntity(
  document: BuildingDocument,
  faceId: string,
): DeleteEntityResult {
  if (!document.faces[faceId]) {
    return err('ENTITY_NOT_FOUND', '删除失败：房间面不存在');
  }

  const next = structuredClone(document);

  // 1. 删除面
  delete next.faces[faceId];

  // 2. 删除涉及该面的关系
  next.relations = next.relations.filter(
    (rel) =>
      rel.from_face_id !== faceId &&
      !(rel.to.kind === 'face' && rel.to.face_id === faceId),
  );

  // 3. 更新楼层 face_ids
  for (const floor of next.floors) {
    floor.face_ids = floor.face_ids.filter((id) => id !== faceId);
  }

  return { ok: true, document: next };
}

// ---- 删除室外区域 ----

function deleteOutsideRegionEntity(
  document: BuildingDocument,
  regionId: string,
): DeleteEntityResult {
  if (!document.outside_regions[regionId]) {
    return err('ENTITY_NOT_FOUND', '删除失败：室外区域不存在');
  }

  const next = structuredClone(document);

  // 1. 删除区域
  delete next.outside_regions[regionId];

  // 2. 删除涉及该区域的关系
  next.relations = next.relations.filter(
    (rel) => !(rel.to.kind === 'outside'),
  );

  return { ok: true, document: next };
}

// ---- 工具函数 ----

function err<C extends string>(
  code: C,
  message: string,
): { ok: false; code: C; message: string } {
  return { ok: false, code, message };
}
