import type {
  BuildingDocument,
  BuildingVertex,
} from '../src/editor/domain/buildingTypes.js';
import {
  exteriorSideSign,
  wallElementRect,
} from '../src/editor/domain/wallElementGeometry.js';

export interface RenderSvgOptions {
  pixelsPerMm: number;
  includeScaleBar: boolean;
}

// ============================================================
// 包围盒
// ============================================================

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeContentBounds(document: BuildingDocument): Bounds | null {
  const referencedIds = new Set<string>();
  for (const wall of Object.values(document.walls)) {
    referencedIds.add(wall.start_vertex_id);
    referencedIds.add(wall.end_vertex_id);
  }
  if (referencedIds.size === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const id of referencedIds) {
    const v = document.vertices[id];
    if (!v) continue;
    minX = Math.min(minX, v.x_mm);
    minY = Math.min(minY, v.y_mm);
    maxX = Math.max(maxX, v.x_mm);
    maxY = Math.max(maxY, v.y_mm);
  }
  return { minX, minY, maxX, maxY };
}

// ============================================================
// 墙体多边形（复用客户端 WallLayer 逻辑）
// ============================================================

function wallPolygon(
  start: BuildingVertex,
  end: BuildingVertex,
  thicknessMm: number,
): BuildingVertex[] {
  const dx = end.x_mm - start.x_mm;
  const dy = end.y_mm - start.y_mm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [start, end];
  const offsetX = (-dy / length) * (thicknessMm / 2);
  const offsetY = (dx / length) * (thicknessMm / 2);
  return [
    { x_mm: start.x_mm + offsetX, y_mm: start.y_mm + offsetY },
    { x_mm: end.x_mm + offsetX, y_mm: end.y_mm + offsetY },
    { x_mm: end.x_mm - offsetX, y_mm: end.y_mm - offsetY },
    { x_mm: start.x_mm - offsetX, y_mm: start.y_mm - offsetY },
  ];
}

// ============================================================
// 院落检测
// ============================================================

function isCourtyardFace(
  faceId: string,
  document: BuildingDocument,
): boolean {
  const faceVertexIds = [...document.faces[faceId].boundary_vertex_ids].sort();
  for (const region of Object.values(document.outside_regions)) {
    const regionIds = [...region.boundary_vertex_ids].sort();
    if (
      faceVertexIds.length === regionIds.length &&
      faceVertexIds.every((id, i) => id === regionIds[i])
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================
// 比例尺
// ============================================================

function niceScaleBarDistance(contentWidthMm: number): {
  distanceMm: number;
  labelMeters: number;
} {
  const meters = contentWidthMm / 1000;
  const magnitude = Math.pow(10, Math.floor(Math.log10(meters)));
  const normalized = meters / magnitude;
  let nice = 1;
  for (const candidate of [1, 2, 5, 10]) {
    if (Math.abs(candidate - normalized) < Math.abs(nice - normalized)) {
      nice = candidate;
    }
  }
  return {
    distanceMm: nice * magnitude * 1000,
    labelMeters: nice * magnitude,
  };
}

// ============================================================
// 构件颜色
// ============================================================

const ELEMENT_COLORS: Record<string, string> = {
  exterior_door: '#f97316',
  interior_door: '#2563eb',
  exterior_window: '#0891b2',
  passage: '#9333ea',
};

/** 内门两端深色竖线（|==|）的颜色 */
const DOOR_MARK_COLOR = '#0f172a';

// ============================================================
// 主渲染函数
// ============================================================

export function renderBuildingSvg(
  document: BuildingDocument,
  options: RenderSvgOptions,
): string {
  const bounds = computeContentBounds(document);
  if (!bounds) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ffffff"/>
</svg>`;
  }

  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const padding = Math.max(200, Math.max(contentWidth, contentHeight) * 0.1);
  const vbMinX = bounds.minX - padding;
  const vbMaxY = bounds.maxY + padding;
  const vbWidth = contentWidth + 2 * padding;
  const vbHeight = contentHeight + 2 * padding;

  // SVG Y 轴向下 → 世界 Y 坐标取负
  const svgMinX = vbMinX;
  const svgMinY = -vbMaxY;

  const widthPx = Math.ceil(vbWidth * options.pixelsPerMm);
  const heightPx = Math.ceil(vbHeight * options.pixelsPerMm);

  function y(worldY: number): number {
    return -worldY;
  }

  // ---- 面 polygon 字符串 ----
  const facePolygons: string[] = [];
  const faceLabels: string[] = [];
  for (const [faceId, face] of Object.entries(document.faces)) {
    const points = face.boundary_vertex_ids
      .map((id) => document.vertices[id])
      .filter(Boolean);
    if (points.length < 3) continue;
    if (isCourtyardFace(faceId, document)) continue;

    const ptsStr = points
      .map((p) => `${p.x_mm},${y(p.y_mm)}`)
      .join(' ');
    const color = /^#[0-9a-f]{6}$/i.test(face.color) ? face.color : '#94a3b8';
    facePolygons.push(
      `<polygon points="${ptsStr}" fill="${color}" fill-opacity="0.32" stroke="none"/>`,
    );

    // 面标签：简单重心
    const cx = points.reduce((s, p) => s + p.x_mm, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y_mm, 0) / points.length;
    if (face.display_name) {
      const fontSize = Math.max(10, 13 / options.pixelsPerMm * 0.5);
      faceLabels.push(
        `<text x="${cx}" y="${y(cy)}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize.toFixed(1)}" fill="#334155" font-family="sans-serif">${escapeXml(face.display_name)}</text>`,
      );
    }
  }

  // ---- 墙 polygon 字符串 ----
  const wallPolygons: string[] = [];
  const wallIds =
    document.floors[0]?.wall_ids ?? Object.keys(document.walls);
  for (const wallId of wallIds) {
    const wall = document.walls[wallId];
    if (!wall) continue;
    const start = document.vertices[wall.start_vertex_id];
    const end = document.vertices[wall.end_vertex_id];
    if (!start || !end) continue;
    const poly = wallPolygon(start, end, wall.thickness_mm);
    const ptsStr = poly.map((p) => `${p.x_mm},${y(p.y_mm)}`).join(' ');
    const fill = wall.wall_type === 'exterior' ? '#334155' : '#64748b';
    wallPolygons.push(`<polygon points="${ptsStr}" fill="${fill}" stroke="none"/>`);
  }

  // ---- 墙上构件 ----
  const elementShapes: string[] = [];
  for (const [elementId, element] of Object.entries(document.wall_elements)) {
    const wall = document.walls[element.host_wall_id];
    if (!wall) continue;
    const start = document.vertices[wall.start_vertex_id];
    const end = document.vertices[wall.end_vertex_id];
    if (!start || !end) continue;
    const dx = end.x_mm - start.x_mm;
    const dy = end.y_mm - start.y_mm;
    const wLength = Math.hypot(dx, dy);
    if (wLength === 0) continue;
    const rect = wallElementRect(
      start,
      end,
      element.offset_from_start_mm,
      element.width_mm,
      wall.thickness_mm,
    );
    const { corners, ux, uy, nx, ny, halfDepth } = rect;
    const fill = ELEMENT_COLORS[element.element_type] ?? '#000000';

    // 外窗 / 无门洞 / 内门 / 外门：实心矩形（垂直方向与墙宽一致）
    const ptsStr = corners
      .map((p) => `${p.x_mm},${y(p.y_mm)}`)
      .join(' ');
    const opacity = element.element_type === 'passage' ? '0.9' : '0.85';
    elementShapes.push(
      `<polygon points="${ptsStr}" fill="${fill}" fill-opacity="${opacity}" stroke="none"/>`,
    );

    // 内门：两端深色竖线（|==|），与外窗/无门洞区分
    if (element.element_type === 'interior_door') {
      const markWidth = Math.max(16, halfDepth * 0.2);
      const sx = start.x_mm + ux * element.offset_from_start_mm;
      const sy = start.y_mm + uy * element.offset_from_start_mm;
      const ex = sx + ux * element.width_mm;
      const ey = sy + uy * element.width_mm;
      elementShapes.push(
        `<line x1="${sx - nx * halfDepth}" y1="${y(sy - ny * halfDepth)}" x2="${sx + nx * halfDepth}" y2="${y(sy + ny * halfDepth)}" stroke="${DOOR_MARK_COLOR}" stroke-width="${markWidth.toFixed(0)}"/>`,
        `<line x1="${ex - nx * halfDepth}" y1="${y(ey - ny * halfDepth)}" x2="${ex + nx * halfDepth}" y2="${y(ey + ny * halfDepth)}" stroke="${DOOR_MARK_COLOR}" stroke-width="${markWidth.toFixed(0)}"/>`,
      );
    }

    // 外门：向外侧开启的门弧
    if (element.element_type === 'exterior_door') {
      const swingSign = exteriorSideSign(document, elementId) ?? 1;
      const snx = nx * swingSign;
      const sny = ny * swingSign;
      const x1 = start.x_mm + ux * element.offset_from_start_mm;
      const y1 = start.y_mm + uy * element.offset_from_start_mm;
      const w = element.width_mm;
      const arc =
        `M ${x1 + snx * halfDepth} ${y(y1 + sny * halfDepth)} ` +
        `Q ${x1 + snx * (halfDepth + w * 0.7) + ux * w * 0.3} ${y(y1 + sny * (halfDepth + w * 0.7) + uy * w * 0.3)} ` +
        `${x1 + snx * (halfDepth + w)} ${y(y1 + sny * (halfDepth + w))}`;
      elementShapes.push(
        `<path d="${arc}" stroke="${fill}" stroke-width="${Math.max(20, halfDepth * 0.3).toFixed(0)}" fill="none" stroke-linecap="round"/>`,
      );
    }
  }

  // ---- 比例尺 ----
  let scaleBarSvg = '';
  if (options.includeScaleBar) {
    const { distanceMm, labelMeters } = niceScaleBarDistance(contentWidth);
    const barLength = Math.min(distanceMm, contentWidth * 0.3);
    const barHeight = Math.max(100, vbHeight * 0.02);
    const margin = padding * 0.5;
    const barX = vbMinX + vbWidth - barLength - margin;
    const barTopY = y(bounds.minY - padding * 0.5);
    const half = barLength / 2;

    scaleBarSvg = [
      `<rect x="${barX}" y="${y(bounds.minY) + barTopY}" width="${half}" height="${barHeight}" fill="#000000"/>`,
      `<rect x="${barX + half}" y="${y(bounds.minY) + barTopY}" width="${half}" height="${barHeight}" fill="#ffffff" stroke="#000000" stroke-width="1"/>`,
      `<text x="${barX + barLength / 2}" y="${y(bounds.minY) + barTopY + barHeight + 60}" text-anchor="middle" font-size="${Math.max(10, barHeight * 0.45).toFixed(1)}" fill="#000000" font-family="sans-serif">${labelMeters}m</text>`,
    ].join('\n');
  }

  // ---- 组装 SVG ----
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${widthPx}" height="${heightPx}"
     viewBox="${svgMinX} ${svgMinY} ${vbWidth} ${vbHeight}">
  <rect x="${svgMinX}" y="${svgMinY}" width="${vbWidth}" height="${vbHeight}" fill="#ffffff"/>
  ${facePolygons.join('\n  ')}
  ${faceLabels.join('\n  ')}
  ${wallPolygons.join('\n  ')}
  ${elementShapes.join('\n  ')}
  ${scaleBarSvg}
</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
