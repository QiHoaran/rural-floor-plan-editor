// ============================================================
// 墙体连续绘制管理 — 自定义 Leaflet 绘制交互
// ============================================================

import L from 'leaflet';
import type { LatLng } from 'leaflet';
import type { WallType, MaterialType } from '@/editor/domain/planTypes.ts';
import { usePlanStore } from '@/editor/store/planStore.ts';
import { generateId } from '@/editor/domain/ids.ts';
import { snapCoordinatePair, findNearestVertex } from '@/editor/domain/snapping.ts';
import { orthoConstraint, fortyFiveConstraint, distance } from '@/editor/domain/geometry.ts';
import { domainXYToLeafletLatLng, leafletLatLngToDomainXY } from '@/editor/leaflet/coordinateAdapter.ts';
import { wallAngleDeg } from '@/editor/domain/wallGeometry.ts';
import { processNewWallTopology } from '@/editor/domain/topologyManager.ts';
import { COLORS, DEFAULT_WALL_HEIGHT_CM } from '@/editor/domain/constants.ts';

export type DrawConstraint = 'ortho' | 'fortyfive' | 'free';

interface DrawState {
  active: boolean;
  started: boolean;
  startPoint: LatLng | null;
  lastPoint: LatLng | null;
  previewLine: L.Polyline | null;
  tempVertexMarkers: L.CircleMarker[];
  vertexIds: string[];
  constraint: DrawConstraint;
}

/**
 * 墙体绘制管理器
 */
export class WallDrawManager {
  private map: L.Map;
  private state: DrawState;
  private previewGroup: L.LayerGroup;
  private tooltip: L.Popup | null = null;

  constructor(map: L.Map, previewGroup: L.LayerGroup) {
    this.map = map;
    this.previewGroup = previewGroup;
    this.state = this.emptyState();
    this.bindEvents();
  }

  private emptyState(): DrawState {
    return {
      active: false,
      started: false,
      startPoint: null,
      lastPoint: null,
      previewLine: null,
      tempVertexMarkers: [],
      vertexIds: [],
      constraint: 'ortho',
    };
  }

  /** 开始绘制 */
  start(): void {
    this.state = this.emptyState();
    this.state.active = true;
    this.map.getContainer().style.cursor = 'crosshair';
  }

  /** 停止绘制 */
  stop(): void {
    this.clearPreview();
    this.state = this.emptyState();
    this.map.getContainer().style.cursor = '';
    this.removeTooltip();
  }

  private bindEvents(): void {
    this.map.on('click', this.handleClick.bind(this));
    this.map.on('mousemove', this.handleMouseMove.bind(this));
    this.map.on('contextmenu', this.handleRightClick.bind(this));
  }

  private getConstraint(event: MouseEvent): DrawConstraint {
    if (event.altKey) return 'free';
    if (event.shiftKey) return 'fortyfive';
    return 'ortho';
  }

  private handleClick(e: L.LeafletMouseEvent): void {
    if (!this.state.active) return;

    const store = usePlanStore.getState();
    if (store.activeTool !== 'exterior_wall' &&
        store.activeTool !== 'interior_wall' &&
        store.activeTool !== 'continuous_wall') return;

    let latlng = e.latlng;
    const [x_cm, y_cm] = leafletLatLngToDomainXY(latlng);
    let snappedX = x_cm;
    let snappedY = y_cm;

    // 顶点吸附
    const nearestV = findNearestVertex(
      snappedX, snappedY,
      store.planDocument.vertices,
      store.snapMode,
    );

    if (nearestV) {
      snappedX = nearestV.x_cm;
      snappedY = nearestV.y_cm;
      latlng = domainXYToLeafletLatLng(snappedX, snappedY);
    } else {
      [snappedX, snappedY] = snapCoordinatePair(snappedX, snappedY, store.snapMode);
      latlng = domainXYToLeafletLatLng(snappedX, snappedY);
    }

    if (!this.state.started) {
      // 第一个点
      this.state.started = true;
      this.state.startPoint = latlng;
      this.state.lastPoint = latlng;

      let vertexId: string;
      if (nearestV) {
        vertexId = nearestV.vertexId;
      } else {
        vertexId = generateId('v');
        store.addVertex(vertexId, { x_cm: snappedX, y_cm: snappedY });
      }
      this.state.vertexIds.push(vertexId);

      const marker = L.circleMarker(latlng, {
        radius: 5, color: COLORS.VERTEX, fillColor: COLORS.VERTEX,
        fillOpacity: 0.8, weight: 1, interactive: false,
      });
      this.previewGroup.addLayer(marker as any);
      this.state.tempVertexMarkers.push(marker);

    } else {
      store.pushUndo('绘制墙体');
      const constraint = this.getConstraint(e.originalEvent);
      const startLatLng = this.state.lastPoint!;
      const [startX, startY] = leafletLatLngToDomainXY(startLatLng);

      // 应用约束
      let finalX = snappedX, finalY = snappedY;
      if (constraint === 'ortho') {
        [finalX, finalY] = orthoConstraint(startX, startY, snappedX, snappedY);
      } else if (constraint === 'fortyfive') {
        [finalX, finalY] = fortyFiveConstraint(startX, startY, snappedX, snappedY);
      }
      const finalLatLng = domainXYToLeafletLatLng(finalX, finalY);

      // 创建结束顶点
      let endVertexId: string;
      if (nearestV) {
        endVertexId = nearestV.vertexId;
      } else {
        endVertexId = generateId('v');
        store.addVertex(endVertexId, { x_cm: finalX, y_cm: finalY });
      }
      this.state.vertexIds.push(endVertexId);

      // 创建墙体
      const wallType: WallType =
        store.activeTool === 'exterior_wall' ? 'exterior' : 'interior';
      const wallId = generateId('w');
      const newWallData = {
        start_vertex_id: this.state.vertexIds[this.state.vertexIds.length - 2],
        end_vertex_id: endVertexId,
        wall_type: wallType as WallType,
        thickness_cm: store.currentWallThickness,
        height_cm: DEFAULT_WALL_HEIGHT_CM,
        material_type: 'brick' as MaterialType,
        review_status: 'draft' as const,
      };
      store.addWall(wallId, newWallData);

      // 拓扑处理（T形/十字拆分）
      const topoResult = processNewWallTopology(
        wallId, newWallData, store.planDocument, store.snapMode,
      );
      if (topoResult.wallsToRemove.length > 0) {
        store.applyTopologyResult(topoResult);
      }

      // 准备画下一条
      this.state.lastPoint = finalLatLng;
      this.state.startPoint = finalLatLng;
      this.clearPreviewLine();

      const marker = L.circleMarker(finalLatLng, {
        radius: 5, color: COLORS.VERTEX, fillColor: COLORS.VERTEX,
        fillOpacity: 0.8, weight: 1, interactive: false,
      });
      this.previewGroup.addLayer(marker as any);
      this.state.tempVertexMarkers.push(marker);

      // 非连续模式结束绘制
      if (store.activeTool !== 'continuous_wall') {
        this.stop();
      }
    }
  }

  private handleMouseMove(e: L.LeafletMouseEvent): void {
    if (!this.state.active || !this.state.started) {
      this.removeTooltip();
      return;
    }

    const store = usePlanStore.getState();
    if (store.activeTool !== 'exterior_wall' &&
        store.activeTool !== 'interior_wall' &&
        store.activeTool !== 'continuous_wall') return;

    let latlng = e.latlng;
    let [x_cm, y_cm] = leafletLatLngToDomainXY(latlng);

    // 吸附
    const nearestV = findNearestVertex(x_cm, y_cm, store.planDocument.vertices, store.snapMode);
    if (nearestV) {
      x_cm = nearestV.x_cm; y_cm = nearestV.y_cm;
      latlng = domainXYToLeafletLatLng(x_cm, y_cm);
    } else {
      [x_cm, y_cm] = snapCoordinatePair(x_cm, y_cm, store.snapMode);
      latlng = domainXYToLeafletLatLng(x_cm, y_cm);
    }

    const startLatLng = this.state.lastPoint!;
    const [startX, startY] = leafletLatLngToDomainXY(startLatLng);
    let finalX = x_cm, finalY = y_cm;

    const constraint = this.getConstraint(e.originalEvent as any);
    if (constraint === 'ortho') {
      [finalX, finalY] = orthoConstraint(startX, startY, x_cm, y_cm);
    } else if (constraint === 'fortyfive') {
      [finalX, finalY] = fortyFiveConstraint(startX, startY, x_cm, y_cm);
    }

    const finalLatLng = domainXYToLeafletLatLng(finalX, finalY);

    // 更新预览线
    this.clearPreviewLine();
    const previewLine = L.polyline([startLatLng, finalLatLng], {
      color: COLORS.WALL_HOVER, weight: 2, dashArray: '8, 4', opacity: 0.6, interactive: false,
    });
    this.previewGroup.addLayer(previewLine as any);
    this.state.previewLine = previewLine;

    // 实时信息
    const len = distance(startX, startY, finalX, finalY);
    const angle = wallAngleDeg({ x_cm: startX, y_cm: startY }, { x_cm: finalX, y_cm: finalY });
    const majorGrids = len / 24;

    this.showTooltip(finalLatLng, `
      <div style="font-size:12px;font-family:monospace;line-height:1.6;">
        长度: <b>${len.toFixed(0)} cm</b> (${(len/100).toFixed(2)} m)<br>
        主网格: ${majorGrids.toFixed(1)} 格<br>
        次网格: ${(len/6).toFixed(1)} 格<br>
        角度: ${angle.toFixed(1)}°<br>
        墙厚: ${store.currentWallThickness} cm
      </div>
    `);
  }

  private handleRightClick(e: L.LeafletMouseEvent): void {
    if (!this.state.active) return;
    e.originalEvent.preventDefault();
    this.stop();
  }

  private clearPreviewLine(): void {
    if (this.state.previewLine) {
      this.previewGroup.removeLayer(this.state.previewLine as any);
      this.state.previewLine = null;
    }
  }

  private clearPreview(): void {
    this.clearPreviewLine();
    this.state.tempVertexMarkers.forEach(m => this.previewGroup.removeLayer(m as any));
    this.state.tempVertexMarkers = [];
  }

  private showTooltip(latlng: LatLng, content: string): void {
    this.removeTooltip();
    this.tooltip = L.popup({
      className: 'wall-draw-tooltip',
      closeButton: false, autoPan: false, offset: [0, -10],
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

  isActive(): boolean {
    return this.state.active;
  }
}
