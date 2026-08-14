import type { BuildingVertex } from '@/editor/domain/buildingTypes.ts';

export interface Viewport {
  originXmm: number;
  originYmm: number;
  pixelsPerMm: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

const MIN_PIXELS_PER_MM = 0.005;
const MAX_PIXELS_PER_MM = 2;
/** CSS 96 DPI 下的 1:150：1 CSS cm 对应 1.5 m。 */
export const DEFAULT_VIEW_PIXELS_PER_MM = (96 / 25.4) / 150;

export function worldToScreen(
  point: BuildingVertex,
  viewport: Viewport,
  size: CanvasSize,
): ScreenPoint {
  return {
    x: (point.x_mm - viewport.originXmm) * viewport.pixelsPerMm,
    y:
      size.height -
      (point.y_mm - viewport.originYmm) * viewport.pixelsPerMm,
  };
}

export function screenToWorld(
  point: ScreenPoint,
  viewport: Viewport,
  size: CanvasSize,
): BuildingVertex {
  return {
    x_mm: viewport.originXmm + point.x / viewport.pixelsPerMm,
    y_mm:
      viewport.originYmm +
      (size.height - point.y) / viewport.pixelsPerMm,
  };
}

export function zoomAt(
  viewport: Viewport,
  cursor: ScreenPoint,
  factor: number,
  size: CanvasSize,
): Viewport {
  const anchor = screenToWorld(cursor, viewport, size);
  const pixelsPerMm = clamp(
    viewport.pixelsPerMm * factor,
    MIN_PIXELS_PER_MM,
    MAX_PIXELS_PER_MM,
  );

  return {
    originXmm: anchor.x_mm - cursor.x / pixelsPerMm,
    originYmm:
      anchor.y_mm - (size.height - cursor.y) / pixelsPerMm,
    pixelsPerMm,
  };
}

export function panBy(
  viewport: Viewport,
  delta: ScreenPoint,
): Viewport {
  return {
    originXmm: viewport.originXmm - delta.x / viewport.pixelsPerMm,
    originYmm: viewport.originYmm + delta.y / viewport.pixelsPerMm,
    pixelsPerMm: viewport.pixelsPerMm,
  };
}

/** 将世界坐标点居中放入画布；viewport 不会写入 Building JSON。 */
export function fitWorldPoints(
  points: readonly BuildingVertex[],
  size: CanvasSize,
  fillRatio = 0.8,
): Viewport {
  if (points.length === 0) {
    return {
      originXmm: 0,
      originYmm: 0,
      pixelsPerMm: DEFAULT_VIEW_PIXELS_PER_MM,
    };
  }
  const xs = points.map((point) => point.x_mm);
  const ys = points.map((point) => point.y_mm);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const widthMm = Math.max(1, maximumX - minimumX);
  const heightMm = Math.max(1, maximumY - minimumY);
  const ratio = clamp(fillRatio, 0.1, 1);
  const pixelsPerMm = clamp(
    Math.min(
      (size.width * ratio) / widthMm,
      (size.height * ratio) / heightMm,
    ),
    MIN_PIXELS_PER_MM,
    MAX_PIXELS_PER_MM,
  );
  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;
  return {
    originXmm: centerX - size.width / pixelsPerMm / 2,
    originYmm: centerY - size.height / pixelsPerMm / 2,
    pixelsPerMm,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
