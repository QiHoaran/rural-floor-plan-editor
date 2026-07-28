import { describe, expect, it } from 'vitest';
import {
  constrainedDirection,
  endpointAtLength,
} from '../../src/editor/domain/cadWall.ts';

describe('constrainedDirection', () => {
  it('selects the dominant orthogonal direction', () => {
    expect(
      constrainedDirection(
        { x_mm: 0, y_mm: 0 },
        { x_mm: 3000, y_mm: 800 },
        'orthogonal',
      ),
    ).toEqual({ dx: 1, dy: 0, angle_deg: 0 });
    expect(
      constrainedDirection(
        { x_mm: 0, y_mm: 0 },
        { x_mm: -200, y_mm: -3000 },
        'orthogonal',
      ),
    ).toEqual({ dx: 0, dy: -1, angle_deg: -90 });
  });

  it('snaps to a 45 degree direction', () => {
    const direction = constrainedDirection(
      { x_mm: 0, y_mm: 0 },
      { x_mm: 1200, y_mm: 1000 },
      'forty_five',
    );
    expect(direction.dx).toBeCloseTo(Math.SQRT1_2, 10);
    expect(direction.dy).toBeCloseTo(Math.SQRT1_2, 10);
    expect(direction.angle_deg).toBe(45);
  });

  it('keeps a normalized free direction', () => {
    const direction = constrainedDirection(
      { x_mm: 100, y_mm: 100 },
      { x_mm: 400, y_mm: 500 },
      'free',
    );
    expect(direction.dx).toBeCloseTo(0.6, 10);
    expect(direction.dy).toBeCloseTo(0.8, 10);
    expect(direction.angle_deg).toBeCloseTo(53.130102, 5);
  });
});

describe('endpointAtLength', () => {
  it('creates exact horizontal and vertical endpoints', () => {
    expect(
      endpointAtLength({ x_mm: 1000, y_mm: 500 }, { dx: 1, dy: 0 }, 4500),
    ).toEqual({ x_mm: 5500, y_mm: 500 });
    expect(
      endpointAtLength({ x_mm: 1000, y_mm: 500 }, { dx: 0, dy: -1 }, 4500),
    ).toEqual({ x_mm: 1000, y_mm: -4000 });
  });

  it('rounds diagonal endpoints to whole millimeters', () => {
    expect(
      endpointAtLength(
        { x_mm: 0, y_mm: 0 },
        { dx: Math.SQRT1_2, dy: Math.SQRT1_2 },
        4500,
      ),
    ).toEqual({ x_mm: 3182, y_mm: 3182 });
  });

  it('rejects non-finite or unsafe millimeter coordinates and lengths', () => {
    expect(() =>
      endpointAtLength(
        { x_mm: Number.POSITIVE_INFINITY, y_mm: 0 },
        { dx: 1, dy: 0 },
        1000,
      ),
    ).toThrow('安全整数');
    expect(() =>
      endpointAtLength(
        { x_mm: 0, y_mm: 0 },
        { dx: 1, dy: 0 },
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).toThrow('安全整数');
  });
});
