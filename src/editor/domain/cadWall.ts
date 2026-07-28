import type { BuildingVertex } from './buildingTypes.ts';

export type DirectionConstraint =
  | 'orthogonal'
  | 'forty_five'
  | 'free';

export interface CadDirection {
  dx: number;
  dy: number;
  angle_deg: number;
}

export function constrainedDirection(
  start: BuildingVertex,
  cursor: BuildingVertex,
  constraint: DirectionConstraint,
): CadDirection {
  const rawX = cursor.x_mm - start.x_mm;
  const rawY = cursor.y_mm - start.y_mm;
  if (rawX === 0 && rawY === 0) {
    return { dx: 1, dy: 0, angle_deg: 0 };
  }

  if (constraint === 'orthogonal') {
    if (Math.abs(rawX) >= Math.abs(rawY)) {
      const dx = rawX < 0 ? -1 : 1;
      return { dx, dy: 0, angle_deg: dx < 0 ? 180 : 0 };
    }
    const dy = rawY < 0 ? -1 : 1;
    return { dx: 0, dy, angle_deg: dy < 0 ? -90 : 90 };
  }

  const rawAngle = Math.atan2(rawY, rawX);
  if (constraint === 'forty_five') {
    const snappedAngle = Math.round(rawAngle / (Math.PI / 4)) * (Math.PI / 4);
    return {
      dx: Math.cos(snappedAngle),
      dy: Math.sin(snappedAngle),
      angle_deg: normalizeAngleDegrees((snappedAngle * 180) / Math.PI),
    };
  }

  const length = Math.hypot(rawX, rawY);
  return {
    dx: rawX / length,
    dy: rawY / length,
    angle_deg: (rawAngle * 180) / Math.PI,
  };
}

export function endpointAtLength(
  start: BuildingVertex,
  direction: Pick<CadDirection, 'dx' | 'dy'>,
  lengthMm: number,
): BuildingVertex {
  assertSafeMillimeter(start.x_mm, '起点 X');
  assertSafeMillimeter(start.y_mm, '起点 Y');
  assertSafeMillimeter(lengthMm, '长度');
  if (!Number.isFinite(direction.dx) || !Number.isFinite(direction.dy)) {
    throw new RangeError('方向必须是有限数值');
  }
  const magnitude = Math.hypot(direction.dx, direction.dy);
  if (magnitude === 0) {
    return { ...start };
  }
  const endpoint = {
    x_mm: Math.round(start.x_mm + (direction.dx / magnitude) * lengthMm),
    y_mm: Math.round(start.y_mm + (direction.dy / magnitude) * lengthMm),
  };
  assertSafeMillimeter(endpoint.x_mm, '终点 X');
  assertSafeMillimeter(endpoint.y_mm, '终点 Y');
  return endpoint;
}

function normalizeAngleDegrees(angle: number): number {
  if (Object.is(angle, -0)) return 0;
  if (angle > 180) return angle - 360;
  return angle;
}

function assertSafeMillimeter(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} 必须是有限的毫米安全整数`);
  }
}
