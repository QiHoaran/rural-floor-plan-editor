// ============================================================
// 门窗放置管理器 — 鼠标靠近墙体 → 高亮 → 单击放置
// ============================================================

import L from 'leaflet';
import type { OpeningType } from '@/editor/domain/planTypes.ts';
import { usePlanStore } from '@/editor/store/planStore.ts';
import { generateId } from '@/editor/domain/ids.ts';
import { findNearestWall, isOpeningWithinWall } from '@/editor/domain/openingGeometry.ts';
import { leafletLatLngToDomainXY, domainXYToLeafletLatLng } from '@/editor/leaflet/coordinateAdapter.ts';
import { COLORS, WALL_HOVER_DISTANCE_CM } from '@/editor/domain/constants.ts';

export class OpeningPlacementManager {
  private map: L.Map;
  private previewGroup: L.LayerGroup;
  private highlightedWall: L.Polyline | null = null;
  private highlightedWallId: string | null = null;
  private previewOpening: L.Polyline | null = null;
  private tooltip: L.Popup | null = null;
  private active: boolean = false;
  private openingType: OpeningType = 'door';

  constructor(map: L.Map, previewGroup: L.LayerGroup) {
    this.map = map;
    this.previewGroup = previewGroup;
    this.bindEvents();
  }

  start(type: OpeningType): void {
    this.active = true;
    this.openingType = type;
    this.map.getContainer().style.cursor = 'crosshair';
  }

  stop(): void {
    this.active = false;
    this.clearPreview();
    this.map.getContainer().style.cursor = '';
  }

  isActive(): boolean {
    return this.active;
  }

  private bindEvents(): void {
    this.map.on('mousemove', this.handleMouseMove.bind(this));
    this.map.on('click', this.handleClick.bind(this));
    this.map.on('keydown', this.handleKeyDown.bind(this));
  }

  private handleMouseMove(e: L.LeafletMouseEvent): void {
    if (!this.active) return;

    const store = usePlanStore.getState();
    if (store.activeTool !== 'door' && store.activeTool !== 'window') return;

    const [x_cm, y_cm] = leafletLatLngToDomainXY(e.latlng);

    const nearest = findNearestWall(
      x_cm, y_cm,
      store.planDocument.walls,
      store.planDocument.vertices,
      WALL_HOVER_DISTANCE_CM,
    );

    if (!nearest) {
      this.clearHighlight();
      this.clearPreviewOpening();
      this.removeTooltip();
      return;
    }

    // 高亮最近的墙
    this.highlightWall(nearest.wallId);

    // 显示门窗预览
    const width = this.openingType === 'door'
      ? store.planDocument.defaults.door_width_cm
      : store.planDocument.defaults.window_width_cm;

    this.showPreviewOpening(
      nearest.wallId,
      nearest.offsetFromStartCm,
      width,
    );

    // 显示工具提示
    this.showTooltip(e.latlng, `
      <div style="font-size:12px;font-family:monospace;">
        ${this.openingType === 'door' ? '门' : '窗'} 宽度: ${width} cm<br>
        偏移: ${nearest.offsetFromStartCm} cm<br>
        墙体: ${nearest.wallId}
      </div>
    `);
  }

  private handleClick(e: L.LeafletMouseEvent): void {
    if (!this.active) return;

    const store = usePlanStore.getState();
    if (store.activeTool !== 'door' && store.activeTool !== 'window') return;

    const [x_cm, y_cm] = leafletLatLngToDomainXY(e.latlng);

    const nearest = findNearestWall(
      x_cm, y_cm,
      store.planDocument.walls,
      store.planDocument.vertices,
      WALL_HOVER_DISTANCE_CM,
    );

    if (!nearest) return;

    const wall = store.planDocument.walls[nearest.wallId];
    const startV = store.planDocument.vertices[wall.start_vertex_id];
    const endV = store.planDocument.vertices[wall.end_vertex_id];
    if (!startV || !endV) return;

    const width = this.openingType === 'door'
      ? store.planDocument.defaults.door_width_cm
      : store.planDocument.defaults.window_width_cm;

    const height = this.openingType === 'door'
      ? 210
      : 150;

    const check = isOpeningWithinWall(
      startV, endV,
      nearest.offsetFromStartCm,
      width,
    );

    if (!check.valid) {
      // 显示错误提示
      this.showTooltip(e.latlng, `
        <div style="font-size:12px;color:${COLORS.ERROR};">
          ✗ ${check.message}
        </div>
      `);
      return;
    }

    store.pushUndo(`添加${this.openingType === 'door' ? '门' : '窗'}`);

    const opId = this.openingType === 'door' ? generateId('d') : generateId('win');

    store.addOpening(opId, {
      opening_type: this.openingType,
      host_wall_id: nearest.wallId,
      offset_from_start_cm: nearest.offsetFromStartCm,
      width_cm: width,
      height_cm: height,
      sill_height_cm: this.openingType === 'window' ? 90 : 0,
      review_status: 'draft',
    });

    // 非连续模式退出
    store.setActiveTool('select');
  }

  private handleKeyDown(e: L.LeafletKeyboardEvent): void {
    if (e.originalEvent.code === 'Escape' && this.active) {
      this.stop();
      usePlanStore.getState().setActiveTool('select');
    }
  }

  private highlightWall(wallId: string): void {
    if (this.highlightedWallId === wallId) return;
    this.clearHighlight();

    const store = usePlanStore.getState();
    const wall = store.planDocument.walls[wallId];
    if (!wall) return;

    const startV = store.planDocument.vertices[wall.start_vertex_id];
    const endV = store.planDocument.vertices[wall.end_vertex_id];
    if (!startV || !endV) return;

    const latlngs = [
      domainXYToLeafletLatLng(startV.x_cm, startV.y_cm),
      domainXYToLeafletLatLng(endV.x_cm, endV.y_cm),
    ];

    const highlight = L.polyline(latlngs, {
      color: COLORS.WALL_HOVER,
      weight: 4,
      opacity: 0.6,
      interactive: false,
    });
    this.previewGroup.addLayer(highlight as any);
    this.highlightedWall = highlight;
    this.highlightedWallId = wallId;
  }

  private clearHighlight(): void {
    if (this.highlightedWall) {
      this.previewGroup.removeLayer(this.highlightedWall as any);
      this.highlightedWall = null;
    }
    this.highlightedWallId = null;
  }

  private showPreviewOpening(
    wallId: string,
    offsetCm: number,
    widthCm: number,
  ): void {
    this.clearPreviewOpening();

    const store = usePlanStore.getState();
    const wall = store.planDocument.walls[wallId];
    if (!wall) return;
    const startV = store.planDocument.vertices[wall.start_vertex_id];
    const endV = store.planDocument.vertices[wall.end_vertex_id];
    if (!startV || !endV) return;

    const dx = endV.x_cm - startV.x_cm;
    const dy = endV.y_cm - startV.y_cm;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen === 0) return;

    const ux = dx / wallLen;
    const uy = dy / wallLen;
    const halfW = widthCm / 2;

    const cx = startV.x_cm + ux * offsetCm;
    const cy = startV.y_cm + uy * offsetCm;
    const sx = cx - ux * halfW;
    const sy = cy - uy * halfW;
    const ex = cx + ux * halfW;
    const ey = cy + uy * halfW;

    const preview = L.polyline(
      [
        domainXYToLeafletLatLng(sx, sy),
        domainXYToLeafletLatLng(ex, ey),
      ],
      {
        color: this.openingType === 'door' ? COLORS.DOOR : COLORS.WINDOW,
        weight: this.openingType === 'door' ? 4 : 3,
        opacity: 0.7,
        interactive: false,
      },
    );
    this.previewGroup.addLayer(preview as any);
    this.previewOpening = preview;
  }

  private clearPreviewOpening(): void {
    if (this.previewOpening) {
      this.previewGroup.removeLayer(this.previewOpening as any);
      this.previewOpening = null;
    }
  }

  private clearPreview(): void {
    this.clearHighlight();
    this.clearPreviewOpening();
    this.removeTooltip();
  }

  private showTooltip(latlng: L.LatLng, content: string): void {
    this.removeTooltip();
    this.tooltip = L.popup({
      className: 'opening-tooltip',
      closeButton: false,
      autoPan: false,
      offset: [0, -10],
    })
      .setLatLng(latlng)
      .setContent(content)
      .openOn(this.map);
  }

  private removeTooltip(): void {
    if (this.tooltip) {
      this.map.closePopup(this.tooltip);
      this.tooltip = null;
    }
  }
}
