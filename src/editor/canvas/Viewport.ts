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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
