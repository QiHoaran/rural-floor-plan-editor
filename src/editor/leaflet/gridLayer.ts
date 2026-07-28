// ============================================================
// Canvas GridLayer — 高性能网格显示
//
// 使用 Canvas 绘制网格，避免大量 Leaflet Polyline 对象
// 网格级别根据缩放动态切换：
//   远距离：仅显示120cm加强网格
//   中距离：显示24cm主网格
//   近距离：显示6cm次网格
//  LOD 阈值通过自定义配置调整
// ============================================================

import L from 'leaflet';
import {
  SUPER_GRID_STEP_CM,
  MAJOR_GRID_STEP_CM,
  MINOR_GRID_STEP_CM,
  COLORS,
} from '@/editor/domain/constants.ts';

export interface GridLayerOptions extends L.GridLayerOptions {
  majorStepCm?: number;
  minorStepCm?: number;
  superStepCm?: number;
  zoomSuperOnly?: number;
  zoomMajorGrid?: number;
  zoomMinorGrid?: number;
}

export const GridLayer = L.GridLayer.extend({
  options: {
    majorStepCm: MAJOR_GRID_STEP_CM,
    minorStepCm: MINOR_GRID_STEP_CM,
    superStepCm: SUPER_GRID_STEP_CM,
    zoomSuperOnly: 0,
    zoomMajorGrid: 2,
    zoomMinorGrid: 4,
    opacity: 1,
  } as GridLayerOptions,

  _mapZoom: 0,

  initialize: function (this: any, options?: GridLayerOptions) {
    L.Util.setOptions(this, options);
    (L.GridLayer.prototype as any).initialize.call(this, this.options);
  },

  createTile: function (this: any, coords: L.Coords, done: Function): HTMLCanvasElement {
    const tileSize = this.getTileSize();
    const canvas = document.createElement('canvas');
    canvas.width = tileSize.x;
    canvas.height = tileSize.y;
    canvas.style.width = `${tileSize.x}px`;
    canvas.style.height = `${tileSize.y}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      done(null, canvas);
      return canvas;
    }

    const zoom = coords.z;
    const map = this._map as L.Map;

    // 计算当前缩放下的像素单位对应的cm值
    const origin = map.unproject([0, 0], zoom);
    const pointAtStep = map.unproject([this.options.majorStepCm, 0], zoom);
    const pxPerCm = Math.abs(pointAtStep.lng - origin.lng);

    // 根据缩放级别决定绘制哪些网格
    const drawSuper = zoom >= this.options.zoomSuperOnly;
    const drawMajor = zoom >= this.options.zoomMajorGrid;
    const drawMinor = zoom >= this.options.zoomMinorGrid;

    ctx.strokeStyle = COLORS.GRID_SUPER;
    ctx.lineWidth = 1.0;

    const tileOrigin = map.unproject([coords.x * tileSize.x, coords.y * tileSize.y], zoom);
    const tileOriginX = tileOrigin.lng;
    const tileOriginY = tileOrigin.lat;

    const tileEndX = tileOriginX + tileSize.x / pxPerCm;
    const tileEndY = tileOriginY + tileSize.y / pxPerCm;

    // 计算网格起始位置（对齐到网格步长）
    const startX = Math.floor(tileOriginX / this.options.superStepCm) * this.options.superStepCm;
    const startY = Math.floor(tileOriginY / this.options.superStepCm) * this.options.superStepCm;

    const ctxStroke = (x: number, y: number, x2: number, y2: number) => {
      const p1 = map.project([y, x], zoom);
      const p2 = map.project([y2, x2], zoom);
      ctx.beginPath();
      ctx.moveTo(p1.x - coords.x * tileSize.x, p1.y - coords.y * tileSize.y);
      ctx.lineTo(p2.x - coords.x * tileSize.x, p2.y - coords.y * tileSize.y);
      ctx.stroke();
    };

    // ---- 加强网格 (120 cm) ----
    if (drawSuper) {
      ctx.strokeStyle = COLORS.GRID_SUPER;
      ctx.lineWidth = 1.2;

      for (let x = startX; x < tileEndX; x += this.options.superStepCm) {
        ctxStroke(x, tileOriginY, x, tileEndY);
      }
      for (let y = startY; y < tileEndY; y += this.options.superStepCm) {
        ctxStroke(tileOriginX, y, tileEndX, y);
      }
    }

    // ---- 主网格 (24 cm) ----
    if (drawMajor) {
      ctx.strokeStyle = COLORS.GRID_MAJOR;
      ctx.lineWidth = 0.8;

      const majorStartX = Math.floor(tileOriginX / this.options.majorStepCm) * this.options.majorStepCm;
      const majorStartY = Math.floor(tileOriginY / this.options.majorStepCm) * this.options.majorStepCm;

      for (let x = majorStartX; x < tileEndX; x += this.options.majorStepCm) {
        // 跳过已在加强网格中的线（避免重复绘制）
        if (x % this.options.superStepCm === 0) continue;
        ctxStroke(x, tileOriginY, x, tileEndY);
      }
      for (let y = majorStartY; y < tileEndY; y += this.options.majorStepCm) {
        if (y % this.options.superStepCm === 0) continue;
        ctxStroke(tileOriginX, y, tileEndX, y);
      }
    }

    // ---- 次网格 (6 cm) ----
    if (drawMinor) {
      ctx.strokeStyle = COLORS.GRID_MINOR;
      ctx.lineWidth = 0.5;

      const minorStartX = Math.floor(tileOriginX / this.options.minorStepCm) * this.options.minorStepCm;
      const minorStartY = Math.floor(tileOriginY / this.options.minorStepCm) * this.options.minorStepCm;

      for (let x = minorStartX; x < tileEndX; x += this.options.minorStepCm) {
        if (x % this.options.majorStepCm === 0) continue;
        ctxStroke(x, tileOriginY, x, tileEndY);
      }
      for (let y = minorStartY; y < tileEndY; y += this.options.minorStepCm) {
        if (y % this.options.majorStepCm === 0) continue;
        ctxStroke(tileOriginX, y, tileEndX, y);
      }
    }

    done(null, canvas);
    return canvas;
  },
}) as unknown as { new (options?: GridLayerOptions): L.GridLayer };

/**
 * 创建网格图层
 */
export function createGridLayer(options?: GridLayerOptions): L.GridLayer {
  return new GridLayer(options);
}
