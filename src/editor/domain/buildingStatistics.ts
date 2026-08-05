// ============================================================
// 建筑统计计算 — 统一统计函数，不在 UI 中临时计算
// ============================================================

import type { BuildingDocument, BuildingStatistics } from './buildingTypes.ts';
import { mmToMeters } from './unitConversion.ts';

/**
 * 计算建筑统计信息
 */
export function computeBuildingStatistics(
  document: BuildingDocument,
): BuildingStatistics {
  const walls = Object.values(document.walls);
  const faces = Object.values(document.faces);
  const elements = Object.values(document.wall_elements);
  const validationIssues = document.validation.issues ?? [];
  const structuredIssues = document.structured_validation ?? [];

  const allIssues = [
    ...validationIssues.map((i) => ({ severity: i.level, code: i.code })),
    ...structuredIssues.map((i) => ({ severity: i.severity, code: i.code })),
  ].filter((issue) => issue.code !== 'REFERENCE_SCALE_MISSING');

  const validation_error_count = allIssues.filter(
    (i) => i.severity === 'error',
  ).length;
  const validation_warning_count = allIssues.filter(
    (i) => i.severity === 'warning',
  ).length;

  // 总建筑面积（mm² → m²）
  const total_floor_area_m2 = faces.reduce((sum, face) => {
    if (!face.area_mm2 || face.area_mm2 <= 0) return sum;
    return sum + mmToMeters(mmToMeters(face.area_mm2)); // mm² → m²
  }, 0);

  const room_count = faces.length;

  // 几何完成度
  const geometry_progress = computeGeometryProgress(document, walls, faces);

  // 房间语义完成度
  const room_semantic_progress = computeRoomSemanticProgress(faces);

  // 门窗完成度
  const opening_progress = computeOpeningProgress(elements);

  return {
    geometry_progress,
    room_semantic_progress,
    opening_progress,
    validation_error_count,
    validation_warning_count,
    total_floor_area_m2: Math.round(total_floor_area_m2 * 100) / 100,
    room_count,
  };
}

/**
 * 几何完成度计算
 *
 * 规则：
 * - 存在墙体 (25%)
 * - 存在房间面 (25%)
 * - 无零长度墙 (25%)
 * - 所有区域已闭合 (25%)
 */
function computeGeometryProgress(
  document: BuildingDocument,
  walls: BuildingDocument['walls'][keyof BuildingDocument['walls']][],
  faces: BuildingDocument['faces'][keyof BuildingDocument['faces']][],
): number {
  let progress = 0;

  if (walls.length > 0) progress += 25;

  if (faces.length > 0) progress += 25;

  const hasZeroLength = walls.some((w) => {
    const s = document.vertices[w.start_vertex_id];
    const e = document.vertices[w.end_vertex_id];
    if (!s || !e) return true;
    return s.x_mm === e.x_mm && s.y_mm === e.y_mm;
  });
  if (!hasZeroLength) progress += 25;

  // 检查是否有未闭合区域（通过拓扑匹配质量判断）
  const closedFaces = faces.filter((f) => f.boundary_vertex_ids.length >= 3);
  if (closedFaces.length > 0 && closedFaces.length === faces.length) {
    progress += 25;
  } else if (closedFaces.length > 0) {
    progress += 12.5;
  }

  return Math.min(100, progress);
}

/**
 * 房间语义完成度
 *
 * 规则：已设置非 unknown 功能的房间数 / 总房间数
 */
function computeRoomSemanticProgress(
  faces: BuildingDocument['faces'][keyof BuildingDocument['faces']][],
): number {
  if (faces.length === 0) return 0;

  const labeled = faces.filter(
    (f) => f.function_code && f.function_code !== 'unknown',
  ).length;

  return Math.round((labeled / faces.length) * 100);
}

/**
 * 门窗完成度
 *
 * 规则：
 * - 门窗具有宿主墙 (30%)
 * - 具有合法宽度 (30%)
 * - 位于墙段范围内 (20%)
 * - 类型明确 (20%)
 */
function computeOpeningProgress(
  elements: BuildingDocument['wall_elements'][keyof BuildingDocument['wall_elements']][],
): number {
  if (elements.length === 0) return 100;

  let progress = 0;

  const withHost = elements.filter((e) => e.host_wall_id).length;
  progress += (withHost / elements.length) * 30;

  const validWidth = elements.filter((e) => e.width_mm > 0).length;
  progress += (validWidth / elements.length) * 30;

  const validStatus = elements.filter((e) => e.status === 'valid').length;
  progress += (validStatus / elements.length) * 20;

  const typed = elements.filter(
    (e) =>
      ['exterior_door', 'exterior_window', 'interior_door', 'passage'].includes(
        e.element_type,
      ),
  ).length;
  progress += (typed / elements.length) * 20;

  return Math.min(100, Math.round(progress));
}

/**
 * 统计未标注房间数量
 */
export function countUnlabeledFaces(
  document: BuildingDocument,
): number {
  return Object.values(document.faces).filter(
    (f) => !f.function_code || f.function_code === 'unknown',
  ).length;
}

/**
 * 获取下一个未标注房间 ID
 */
export function getNextUnlabeledFaceId(
  document: BuildingDocument,
  currentId?: string,
): string | null {
  const faceIds = Object.keys(document.faces);
  if (faceIds.length === 0) return null;

  const currentIndex = currentId ? faceIds.indexOf(currentId) : -1;
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

  for (let i = startIndex; i < faceIds.length; i++) {
    const face = document.faces[faceIds[i]];
    if (!face.function_code || face.function_code === 'unknown') {
      return faceIds[i];
    }
  }

  // 循环到开头
  for (let i = 0; i < startIndex; i++) {
    const face = document.faces[faceIds[i]];
    if (!face.function_code || face.function_code === 'unknown') {
      return faceIds[i];
    }
  }

  return null;
}

/**
 * 按功能代码统计房间
 */
export function countFacesByFunction(
  document: BuildingDocument,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const face of Object.values(document.faces)) {
    const code = face.function_code ?? 'unknown';
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}
