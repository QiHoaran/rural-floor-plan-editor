import type { BuildingDocument, BuildingVertex } from '../domain/buildingTypes.ts';
import { moveVertex } from './pointMoveCommand.ts';

export type AlignmentAxis = 'horizontal' | 'vertical';
export type FixedEnd = 'start' | 'end';
export type OrthogonalRepairResult = { ok: false; code: string; message: string } | {
  ok: true; document: BuildingDocument; vertexId: string; target: BuildingVertex;
  axis: AlignmentAxis; fixedEnd: FixedEnd; distanceMm: number; affectedWallIds: string[];
};

export function previewOrthogonalRepair(
  document: BuildingDocument, wallId: string, fixedEnd: FixedEnd = 'start', axis?: AlignmentAxis,
): OrthogonalRepairResult {
  if (document.workflow.status === 'complete') return { ok: false, code: 'READ_ONLY', message: '已完成项目为只读，无法修复' };
  const wall = document.walls[wallId];
  if (!wall) return { ok: false, code: 'WALL_MISSING', message: '墙体不存在' };
  const fixed = document.vertices[fixedEnd === 'start' ? wall.start_vertex_id : wall.end_vertex_id];
  const vertexId = fixedEnd === 'start' ? wall.end_vertex_id : wall.start_vertex_id;
  const moving = document.vertices[vertexId];
  if (!fixed || !moving) return { ok: false, code: 'VERTEX_MISSING', message: '墙体端点不存在' };
  const direction = axis ?? (Math.abs(moving.y_mm - fixed.y_mm) <= Math.abs(moving.x_mm - fixed.x_mm) ? 'horizontal' : 'vertical');
  const target = direction === 'horizontal' ? { ...moving, y_mm: fixed.y_mm } : { ...moving, x_mm: fixed.x_mm };
  if (target.x_mm === fixed.x_mm && target.y_mm === fixed.y_mm) return { ok: false, code: 'ZERO_LENGTH', message: '该方向会产生零长度墙，请切换对齐方向' };
  const result = moveVertex(document, vertexId, target);
  if (!result.ok) return result;
  // Topology normalization uses a 1 mm merge tolerance. It must not silently
  // undo exact alignment or move the fixed endpoint through a nearby vertex.
  const actual = result.document.vertices[result.vertexId];
  const coordinate = direction === 'horizontal' ? 'x_mm' : 'y_mm';
  const constant = direction === 'horizontal' ? 'y_mm' : 'x_mm';
  const lo = Math.min(fixed[coordinate], target[coordinate]);
  const hi = Math.max(fixed[coordinate], target[coordinate]);
  const intervals = Object.values(result.document.walls).flatMap(w => {
    const a = result.document.vertices[w.start_vertex_id], b = result.document.vertices[w.end_vertex_id];
    if (!a || !b || a[constant] !== fixed[constant] || b[constant] !== fixed[constant]) return [];
    return [[Math.max(lo, Math.min(a[coordinate], b[coordinate])), Math.min(hi, Math.max(a[coordinate], b[coordinate]))]];
  }).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let covered = lo;
  for (const [a, b] of intervals) { if (a > covered) break; covered = Math.max(covered, b); }
  const fixedPreserved = Object.values(result.document.vertices).some(p => p.x_mm === fixed.x_mm && p.y_mm === fixed.y_mm);
  if (!fixedPreserved || actual.x_mm !== target.x_mm || actual.y_mm !== target.y_mm || covered < hi) {
    return { ok: false, code: 'ALIGNMENT_CONFLICT', message: '邻近顶点或交点吸附使墙体无法精确正交，请切换固定端点、对齐方向，或先调整邻近顶点' };
  }
  return { ...result, target, axis: direction, fixedEnd,
    distanceMm: Math.hypot(target.x_mm - moving.x_mm, target.y_mm - moving.y_mm),
    affectedWallIds: Object.entries(document.walls).filter(([, w]) => w.start_vertex_id === vertexId || w.end_vertex_id === vertexId).map(([id]) => id).sort(),
  };
}
