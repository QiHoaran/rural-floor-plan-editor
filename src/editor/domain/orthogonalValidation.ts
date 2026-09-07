import type { BuildingDocument, BuildingVertex, ValidationIssue } from './buildingTypes.ts';

export const ORTHOGONAL_NOTICE = '影响 Embodied_V2 转换，不影响审核通过';
export function isOrthogonalIssue(code: string): boolean {
  return code === 'WALL_NOT_AXIS_ALIGNED' || code === 'FACE_EDGE_NOT_AXIS_ALIGNED';
}

function valid(p: BuildingVertex | undefined): p is BuildingVertex {
  return !!p && Number.isSafeInteger(p.x_mm) && Number.isSafeInteger(p.y_mm);
}
function diagonal(a: BuildingVertex | undefined, b: BuildingVertex | undefined): boolean {
  return valid(a) && valid(b) && a.x_mm !== b.x_mm && a.y_mm !== b.y_mm;
}

// Exact collinearity, even when integer cross products exceed Number precision.
function collinear(a: BuildingVertex, b: BuildingVertex, p: BuildingVertex): boolean {
  return (BigInt(b.x_mm) - BigInt(a.x_mm)) * (BigInt(p.y_mm) - BigInt(a.y_mm)) ===
    (BigInt(b.y_mm) - BigInt(a.y_mm)) * (BigInt(p.x_mm) - BigInt(a.x_mm));
}

export function checkOrthogonality(document: BuildingDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const diagonals: Array<[BuildingVertex, BuildingVertex]> = [];
  const created_at = new Date().toISOString();
  const add = (code: string, type: 'wall' | 'face', id: string, a: BuildingVertex, b: BuildingVertex, edge?: number) => {
    issues.push({ id: `${code}:${id}:${edge ?? ''}`, code, severity: 'warning', category: 'geometry',
      message_key: code, entity_type: type, entity_id: id, created_at,
      message_params: { entity_id: id, dx_mm: Math.abs(b.x_mm - a.x_mm), dy_mm: Math.abs(b.y_mm - a.y_mm), ...(edge === undefined ? {} : { edge_index: edge }) },
      fix_suggestion_key: type === 'wall' ? 'fix.wall_axis_alignment' : 'fix.face_axis_alignment' });
  };
  for (const [id, wall] of Object.entries(document.walls).sort(([a], [b]) => a.localeCompare(b))) {
    const a = document.vertices[wall.start_vertex_id], b = document.vertices[wall.end_vertex_id];
    if (!diagonal(a, b)) continue;
    diagonals.push([a, b]);
    add('WALL_NOT_AXIS_ALIGNED', 'wall', id, a, b);
  }
  for (const [id, face] of Object.entries(document.faces)) {
    const ids = face.boundary_vertex_ids;
    for (let i = 0; i < ids.length; i++) {
      const a = document.vertices[ids[i]], b = document.vertices[ids[(i + 1) % ids.length]];
      if (!diagonal(a, b)) continue;
      // A boundary may span several hosts; suppress only when their union covers it.
      const lo = Math.min(a.x_mm, b.x_mm), hi = Math.max(a.x_mm, b.x_mm);
      const intervals = diagonals.filter(([c, d]) => collinear(a, b, c) && collinear(a, b, d))
        .map(([c, d]) => [Math.max(lo, Math.min(c.x_mm, d.x_mm)), Math.min(hi, Math.max(c.x_mm, d.x_mm))])
        .filter(([start, end]) => end > start).sort((x, y) => x[0] - y[0]);
      let covered = lo;
      for (const [start, end] of intervals) {
        if (start > covered) break;
        covered = Math.max(covered, end);
      }
      if (covered < hi) add('FACE_EDGE_NOT_AXIS_ALIGNED', 'face', id, a, b, i);
    }
  }
  return issues;
}

export function orthogonalitySummary(document: BuildingDocument) {
  const issues = checkOrthogonality(document);
  return {
    non_axis_aligned_wall_count: issues.filter(i => i.entity_type === 'wall').length,
    non_axis_aligned_face_edge_count: issues.filter(i => i.entity_type === 'face').length,
  };
}
