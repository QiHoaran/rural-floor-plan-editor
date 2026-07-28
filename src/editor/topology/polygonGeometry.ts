export interface PolygonPoint {
  x_mm: number;
  y_mm: number;
}

export interface PolygonMetrics {
  area: number;
  centroid: PolygonPoint;
}

type Triangle = [PolygonPoint, PolygonPoint, PolygonPoint];

const EPSILON = 1e-9;

function isFinitePoint(point: PolygonPoint): boolean {
  return Number.isFinite(point.x_mm) && Number.isFinite(point.y_mm);
}

function allSafeIntegers(points: PolygonPoint[]): boolean {
  return points.every(
    (point) =>
      Number.isSafeInteger(point.x_mm) && Number.isSafeInteger(point.y_mm),
  );
}

function translated(points: PolygonPoint[], origin: PolygonPoint): PolygonPoint[] {
  return points.map((point) => ({
    x_mm: point.x_mm - origin.x_mm,
    y_mm: point.y_mm - origin.y_mm,
  }));
}

function numericSignedDoubleArea(points: PolygonPoint[]): number {
  if (points.length < 3 || points.some((point) => !isFinitePoint(point))) {
    return Number.NaN;
  }
  const local = translated(points, points[0]);
  let total = 0;
  for (let index = 0; index < local.length; index += 1) {
    const current = local[index];
    const next = local[(index + 1) % local.length];
    total += current.x_mm * next.y_mm - next.x_mm * current.y_mm;
  }
  return total;
}

/**
 * Computes signed double area after local translation. Integer input uses an
 * exact BigInt determinant before its final conversion to number.
 */
export function polygonSignedDoubleArea(points: PolygonPoint[]): number {
  if (points.length < 3 || points.some((point) => !isFinitePoint(point))) {
    return Number.NaN;
  }
  if (!allSafeIntegers(points)) return numericSignedDoubleArea(points);

  const origin = points[0];
  const local = points.map((point) => ({
    x: BigInt(point.x_mm) - BigInt(origin.x_mm),
    y: BigInt(point.y_mm) - BigInt(origin.y_mm),
  }));
  let total = 0n;
  for (let index = 0; index < local.length; index += 1) {
    const current = local[index];
    const next = local[(index + 1) % local.length];
    total += current.x * next.y - next.x * current.y;
  }
  return Number(total);
}

function crossNumber(
  start: PolygonPoint,
  middle: PolygonPoint,
  end: PolygonPoint,
): number {
  return (
    (middle.x_mm - start.x_mm) * (end.y_mm - start.y_mm) -
    (middle.y_mm - start.y_mm) * (end.x_mm - start.x_mm)
  );
}

function crossSign(
  start: PolygonPoint,
  middle: PolygonPoint,
  end: PolygonPoint,
): number {
  if (
    allSafeIntegers([start, middle, end])
  ) {
    const ax = BigInt(middle.x_mm) - BigInt(start.x_mm);
    const ay = BigInt(middle.y_mm) - BigInt(start.y_mm);
    const bx = BigInt(end.x_mm) - BigInt(start.x_mm);
    const by = BigInt(end.y_mm) - BigInt(start.y_mm);
    const cross = ax * by - ay * bx;
    return cross < 0n ? -1 : cross > 0n ? 1 : 0;
  }
  const cross = crossNumber(start, middle, end);
  return cross < -EPSILON ? -1 : cross > EPSILON ? 1 : 0;
}

export function areCollinear(
  start: PolygonPoint,
  middle: PolygonPoint,
  end: PolygonPoint,
): boolean {
  return crossSign(start, middle, end) === 0;
}

export function polygonMetrics(
  points: PolygonPoint[],
): PolygonMetrics | undefined {
  const signedDoubleArea = polygonSignedDoubleArea(points);
  if (!Number.isFinite(signedDoubleArea) || signedDoubleArea === 0) {
    return undefined;
  }

  const origin = points[0];
  const local = translated(points, origin);
  let localDoubleArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < local.length; index += 1) {
    const current = local[index];
    const next = local[(index + 1) % local.length];
    const cross = current.x_mm * next.y_mm - next.x_mm * current.y_mm;
    localDoubleArea += cross;
    weightedX += (current.x_mm + next.x_mm) * cross;
    weightedY += (current.y_mm + next.y_mm) * cross;
  }
  if (
    !Number.isFinite(localDoubleArea) ||
    localDoubleArea === 0 ||
    !Number.isFinite(weightedX) ||
    !Number.isFinite(weightedY)
  ) {
    return undefined;
  }
  const centroid = {
    x_mm: origin.x_mm + weightedX / (3 * localDoubleArea),
    y_mm: origin.y_mm + weightedY / (3 * localDoubleArea),
  };
  const area = Math.abs(signedDoubleArea) / 2;
  if (
    !Number.isFinite(area) ||
    area <= 0 ||
    !Number.isFinite(centroid.x_mm) ||
    !Number.isFinite(centroid.y_mm)
  ) {
    return undefined;
  }
  return { area, centroid };
}

function samePoint(left: PolygonPoint, right: PolygonPoint): boolean {
  return left.x_mm === right.x_mm && left.y_mm === right.y_mm;
}

function cleanPolygon(points: PolygonPoint[]): PolygonPoint[] {
  const deduplicated: PolygonPoint[] = [];
  for (const point of points) {
    if (!isFinitePoint(point)) return [];
    if (!deduplicated.length || !samePoint(deduplicated.at(-1)!, point)) {
      deduplicated.push(point);
    }
  }
  if (
    deduplicated.length > 1 &&
    samePoint(deduplicated[0], deduplicated.at(-1)!)
  ) {
    deduplicated.pop();
  }

  let result = deduplicated;
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    const kept: PolygonPoint[] = [];
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];
      if (areCollinear(previous, current, next)) {
        changed = true;
      } else {
        kept.push(current);
      }
    }
    result = kept;
  }
  return result;
}

function pointInTriangle(point: PolygonPoint, triangle: Triangle): boolean {
  const signs = triangle.map((start, index) =>
    crossNumber(start, triangle[(index + 1) % 3], point),
  );
  return signs.every((value) => value >= -EPSILON);
}

function triangulate(points: PolygonPoint[]): Triangle[] | undefined {
  let polygon = cleanPolygon(points);
  const area = polygonSignedDoubleArea(polygon);
  if (polygon.length < 3 || !Number.isFinite(area) || area === 0) {
    return undefined;
  }
  if (area < 0) polygon = [...polygon].reverse();

  const remaining = polygon.map((_, index) => index);
  const triangles: Triangle[] = [];
  while (remaining.length > 3) {
    let earIndex = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index - 1 + remaining.length) % remaining.length];
      const current = remaining[index];
      const next = remaining[(index + 1) % remaining.length];
      const triangle: Triangle = [
        polygon[previous],
        polygon[current],
        polygon[next],
      ];
      if (crossNumber(triangle[0], triangle[1], triangle[2]) <= EPSILON) {
        continue;
      }
      const containsOther = remaining.some(
        (candidate) =>
          candidate !== previous &&
          candidate !== current &&
          candidate !== next &&
          pointInTriangle(polygon[candidate], triangle),
      );
      if (!containsOther) {
        earIndex = index;
        triangles.push(triangle);
        break;
      }
    }
    if (earIndex < 0) return undefined;
    remaining.splice(earIndex, 1);
  }
  triangles.push([
    polygon[remaining[0]],
    polygon[remaining[1]],
    polygon[remaining[2]],
  ]);
  return triangles;
}

function lineIntersection(
  segmentStart: PolygonPoint,
  segmentEnd: PolygonPoint,
  clipStart: PolygonPoint,
  clipEnd: PolygonPoint,
): PolygonPoint | undefined {
  const segment = {
    x_mm: segmentEnd.x_mm - segmentStart.x_mm,
    y_mm: segmentEnd.y_mm - segmentStart.y_mm,
  };
  const clip = {
    x_mm: clipEnd.x_mm - clipStart.x_mm,
    y_mm: clipEnd.y_mm - clipStart.y_mm,
  };
  const denominator = segment.x_mm * clip.y_mm - segment.y_mm * clip.x_mm;
  if (Math.abs(denominator) <= EPSILON) return undefined;
  const offset = {
    x_mm: clipStart.x_mm - segmentStart.x_mm,
    y_mm: clipStart.y_mm - segmentStart.y_mm,
  };
  const t =
    (offset.x_mm * clip.y_mm - offset.y_mm * clip.x_mm) / denominator;
  const point = {
    x_mm: segmentStart.x_mm + t * segment.x_mm,
    y_mm: segmentStart.y_mm + t * segment.y_mm,
  };
  return isFinitePoint(point) ? point : undefined;
}

function clipTriangle(subject: Triangle, clip: Triangle): PolygonPoint[] {
  let output: PolygonPoint[] = [...subject];
  for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
    const clipStart = clip[edgeIndex];
    const clipEnd = clip[(edgeIndex + 1) % 3];
    const input = output;
    output = [];
    if (input.length === 0) break;
    let previous = input.at(-1)!;
    let previousInside =
      crossNumber(clipStart, clipEnd, previous) >= -EPSILON;
    for (const current of input) {
      const currentInside =
        crossNumber(clipStart, clipEnd, current) >= -EPSILON;
      if (currentInside !== previousInside) {
        const intersection = lineIntersection(
          previous,
          current,
          clipStart,
          clipEnd,
        );
        if (intersection) output.push(intersection);
      }
      if (currentInside) output.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }
  return output;
}

function absoluteArea(points: PolygonPoint[]): number {
  return Math.abs(numericSignedDoubleArea(points)) / 2;
}

/**
 * Computes true simple-polygon IoU by ear-clipping each polygon and summing
 * pairwise triangle intersections. Undefined means invalid/non-finite geometry.
 */
export function polygonIntersectionOverUnion(
  left: PolygonPoint[],
  right: PolygonPoint[],
): number | undefined {
  if (
    left.length < 3 ||
    right.length < 3 ||
    [...left, ...right].some((point) => !isFinitePoint(point))
  ) {
    return undefined;
  }
  const origin = left[0];
  const localLeft = translated(left, origin);
  const localRight = translated(right, origin);
  const leftMetrics = polygonMetrics(localLeft);
  const rightMetrics = polygonMetrics(localRight);
  const leftTriangles = triangulate(localLeft);
  const rightTriangles = triangulate(localRight);
  if (!leftMetrics || !rightMetrics || !leftTriangles || !rightTriangles) {
    return undefined;
  }

  let intersection = 0;
  for (const leftTriangle of leftTriangles) {
    for (const rightTriangle of rightTriangles) {
      const clipped = clipTriangle(leftTriangle, rightTriangle);
      if (clipped.length >= 3) intersection += absoluteArea(clipped);
    }
  }
  intersection = Math.max(
    0,
    Math.min(intersection, leftMetrics.area, rightMetrics.area),
  );
  const union = leftMetrics.area + rightMetrics.area - intersection;
  const iou = union > 0 ? intersection / union : Number.NaN;
  return Number.isFinite(iou) ? iou : undefined;
}
