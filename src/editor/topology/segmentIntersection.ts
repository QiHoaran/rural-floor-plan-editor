export interface MillimeterPoint {
  x_mm: number;
  y_mm: number;
}

export type SegmentIntersection =
  | { kind: 'none' }
  | {
      kind: 'point';
      point: MillimeterPoint;
      tA: number;
      tB: number;
    }
  | {
      kind: 'overlap';
      from: MillimeterPoint;
      to: MillimeterPoint;
    };

const NONE: SegmentIntersection = { kind: 'none' };

function subtract(a: MillimeterPoint, b: MillimeterPoint): MillimeterPoint {
  return { x_mm: a.x_mm - b.x_mm, y_mm: a.y_mm - b.y_mm };
}

function cross(a: MillimeterPoint, b: MillimeterPoint): number {
  return a.x_mm * b.y_mm - a.y_mm * b.x_mm;
}

function dot(a: MillimeterPoint, b: MillimeterPoint): number {
  return a.x_mm * b.x_mm + a.y_mm * b.y_mm;
}

function length(vector: MillimeterPoint): number {
  return Math.hypot(vector.x_mm, vector.y_mm);
}

function distance(a: MillimeterPoint, b: MillimeterPoint): number {
  return Math.hypot(a.x_mm - b.x_mm, a.y_mm - b.y_mm);
}

function pointAlong(
  start: MillimeterPoint,
  vector: MillimeterPoint,
  t: number,
): MillimeterPoint {
  return {
    x_mm: start.x_mm + vector.x_mm * t,
    y_mm: start.y_mm + vector.y_mm * t,
  };
}

function rounded(point: MillimeterPoint): MillimeterPoint {
  return {
    x_mm: Math.round(point.x_mm),
    y_mm: Math.round(point.y_mm),
  };
}

function clampParameter(value: number, parameterTolerance: number): number {
  if (Math.abs(value) <= parameterTolerance) return 0;
  if (Math.abs(value - 1) <= parameterTolerance) return 1;
  return Math.min(1, Math.max(0, value));
}

function normalizeToEndpoint(
  point: MillimeterPoint,
  endpoints: MillimeterPoint[],
  toleranceMm: number,
): MillimeterPoint {
  const numericalSlack =
    Number.EPSILON *
    Math.max(
      1,
      Math.abs(point.x_mm),
      Math.abs(point.y_mm),
      ...endpoints.flatMap((endpoint) => [
        Math.abs(endpoint.x_mm),
        Math.abs(endpoint.y_mm),
      ]),
    ) *
    16;
  const eligible = endpoints
    .filter(
      (endpoint) =>
        distance(point, endpoint) <= toleranceMm + numericalSlack,
    )
    .sort(
      (left, right) =>
        left.x_mm - right.x_mm || left.y_mm - right.y_mm,
    );
  return eligible[0] ?? point;
}

/**
 * Intersects two closed line segments using cross products.
 *
 * Coordinates in the result are persisted as integer millimeters. Contacts no
 * farther than `toleranceMm` beyond an endpoint are normalized to that endpoint.
 */
export function intersectSegments(
  aStart: MillimeterPoint,
  aEnd: MillimeterPoint,
  bStart: MillimeterPoint,
  bEnd: MillimeterPoint,
  toleranceMm = 1,
): SegmentIntersection {
  const r = subtract(aEnd, aStart);
  const s = subtract(bEnd, bStart);
  const aLength = length(r);
  const bLength = length(s);
  if (aLength === 0 || bLength === 0) return NONE;

  const qMinusP = subtract(bStart, aStart);
  const rCrossS = cross(r, s);
  const qMinusPCrossR = cross(qMinusP, r);
  const scale = Math.max(1, aLength * bLength);
  const parallelEpsilon = Number.EPSILON * scale * 8;
  const aTolerance = toleranceMm / aLength;
  const bTolerance = toleranceMm / bLength;

  if (Math.abs(rCrossS) <= parallelEpsilon) {
    if (Math.abs(qMinusPCrossR) > Number.EPSILON * Math.max(1, aLength) * 8) {
      return NONE;
    }

    const rSquared = dot(r, r);
    const bStartOnA = dot(qMinusP, r) / rSquared;
    const bEndOnA = bStartOnA + dot(s, r) / rSquared;
    const overlapStart = Math.max(0, Math.min(bStartOnA, bEndOnA));
    const overlapEnd = Math.min(1, Math.max(bStartOnA, bEndOnA));

    if (overlapEnd < overlapStart - aTolerance) return NONE;

    if (overlapEnd <= overlapStart) {
      const rawPoint = pointAlong(
        aStart,
        r,
        Math.min(1, Math.max(0, (overlapStart + overlapEnd) / 2)),
      );
      const point = rounded(
        normalizeToEndpoint(
          rawPoint,
          [aStart, aEnd, bStart, bEnd],
          toleranceMm,
        ),
      );
      const tA = distance(point, aStart) <= toleranceMm ? 0
        : distance(point, aEnd) <= toleranceMm ? 1
          : dot(subtract(point, aStart), r) / rSquared;
      const sSquared = dot(s, s);
      const tB = distance(point, bStart) <= toleranceMm ? 0
        : distance(point, bEnd) <= toleranceMm ? 1
          : dot(subtract(point, bStart), s) / sSquared;
      return { kind: 'point', point, tA, tB };
    }

    const overlapPoints = [
      rounded(pointAlong(aStart, r, overlapStart)),
      rounded(pointAlong(aStart, r, overlapEnd)),
    ].sort(
      (left, right) =>
        left.x_mm - right.x_mm || left.y_mm - right.y_mm,
    );
    return {
      kind: 'overlap',
      from: overlapPoints[0],
      to: overlapPoints[1],
    };
  }

  const tA = cross(qMinusP, s) / rCrossS;
  const tB = cross(qMinusP, r) / rCrossS;
  if (
    tA < -aTolerance ||
    tA > 1 + aTolerance ||
    tB < -bTolerance ||
    tB > 1 + bTolerance
  ) {
    return NONE;
  }

  const normalizedTA = clampParameter(tA, aTolerance);
  const normalizedTB = clampParameter(tB, bTolerance);
  const rawPoint = pointAlong(aStart, r, tA);
  const point = rounded(
    normalizeToEndpoint(
      rawPoint,
      [aStart, aEnd, bStart, bEnd],
      toleranceMm,
    ),
  );

  return {
    kind: 'point',
    point,
    tA: normalizedTA,
    tB: normalizedTB,
  };
}
