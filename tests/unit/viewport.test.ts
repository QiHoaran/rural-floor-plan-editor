import { describe, expect, it } from 'vitest';
import {
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type CanvasSize,
  type Viewport,
} from '../../src/editor/canvas/Viewport.ts';

const size: CanvasSize = { width: 1000, height: 600 };
const viewport: Viewport = {
  originXmm: 0,
  originYmm: 0,
  pixelsPerMm: 0.2,
};

describe('SVG viewport transforms', () => {
  it('round-trips between world and screen coordinates', () => {
    const world = { x_mm: 1000, y_mm: 500 };
    const screen = worldToScreen(world, viewport, size);

    expect(screen).toEqual({ x: 200, y: 500 });
    expect(screenToWorld(screen, viewport, size)).toEqual(world);
  });

  it('keeps the world point below the cursor fixed while zooming', () => {
    const cursor = { x: 300, y: 240 };
    const before = screenToWorld(cursor, viewport, size);
    const zoomed = zoomAt(viewport, cursor, 1.5, size);
    const after = screenToWorld(cursor, zoomed, size);

    expect(after.x_mm).toBeCloseTo(before.x_mm, 10);
    expect(after.y_mm).toBeCloseTo(before.y_mm, 10);
    expect(zoomed.pixelsPerMm).toBeCloseTo(0.3, 10);
  });

  it('clamps zoom between supported limits', () => {
    expect(zoomAt(viewport, { x: 0, y: 0 }, 100, size).pixelsPerMm).toBe(2);
    expect(zoomAt(viewport, { x: 0, y: 0 }, 0.001, size).pixelsPerMm).toBe(
      0.005,
    );
  });

  it('pans by screen pixels without changing zoom', () => {
    expect(panBy(viewport, { x: 40, y: 20 })).toEqual({
      originXmm: -200,
      originYmm: 100,
      pixelsPerMm: 0.2,
    });
  });
});
