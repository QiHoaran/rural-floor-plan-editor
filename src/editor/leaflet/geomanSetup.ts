// ============================================================
// Geoman 配置 — 仅用于顶点拖拽编辑
// ============================================================

import type L from 'leaflet';

/**
 * 配置 Geoman 仅用于顶点编辑模式
 */
export function setupGeomanForEditing(map: L.Map): void {
  // Geoman 使用 Map.pm API
  const pm = (map as any).pm;
  if (!pm) return;

  pm.setOptions({
    snappable: true,
    snapDistance: 24,
  });

  pm.addControls({
    position: 'topleft',
    drawMarker: false,
    drawCircleMarker: false,
    drawPolyline: false,
    drawRectangle: false,
    drawPolygon: false,
    drawCircle: false,
    drawText: false,
    cutPolygon: false,
    editMode: true,
    dragMode: true,
    removalMode: false,
    rotateMode: false,
    snappingOption: true,
  });
}
