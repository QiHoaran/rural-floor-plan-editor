// ============================================================
// 图层事件绑定 — 将 Leaflet/Geoman 事件映射到 Store 操作
// ============================================================

import type L from 'leaflet';
import { usePlanStore } from '@/editor/store/planStore.ts';

/**
 * 绑定所有图层选择/交互事件
 */
export function bindLayerEvents(map: L.Map): () => void {
  const handleMapClick = () => {
    usePlanStore.getState().setSelectedEntity(null, 'none');
  };

  map.on('click', handleMapClick);
  return () => { map.off('click', handleMapClick); };
}

/**
 * 绑定鼠标悬停事件
 */
export function bindHoverEvents(map: L.Map): () => void {
  const handleMouseOver = (e: L.LeafletMouseEvent) => {
    const layer = e.target as any;
    if (layer.entityType === 'wall') {
      usePlanStore.getState().setHoveredWallId(layer.entityId);
    }
  };
  const handleMouseOut = () => {
    usePlanStore.getState().setHoveredWallId(null);
  };

  map.on('mouseover', handleMouseOver);
  map.on('mouseout', handleMouseOut);
  return () => {
    map.off('mouseover', handleMouseOver);
    map.off('mouseout', handleMouseOut);
  };
}
