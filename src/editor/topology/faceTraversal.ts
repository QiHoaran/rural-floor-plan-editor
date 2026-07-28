import type {
  BuildingDocument,
  BuildingVertex,
  BuildingWall,
} from '../domain/buildingTypes.ts';
import {
  areCollinear,
  polygonSignedDoubleArea,
} from './polygonGeometry.ts';

export interface DerivedFace {
  boundary_vertex_ids: string[];
  area_mm2: number;
}

export type FaceGraph = Pick<BuildingDocument, 'vertices' | 'walls'>;

interface HalfEdge {
  key: string;
  from: string;
  to: string;
  twinKey: string;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareVertexIds(
  leftId: string,
  rightId: string,
  vertices: Record<string, BuildingVertex>,
): number {
  const left = vertices[leftId];
  const right = vertices[rightId];
  return (
    left.x_mm - right.x_mm ||
    left.y_mm - right.y_mm ||
    compareStrings(leftId, rightId)
  );
}

function coordinateKey(vertex: BuildingVertex): string {
  return `${vertex.x_mm},${vertex.y_mm}`;
}

function undirectedCoordinateKey(
  start: BuildingVertex,
  end: BuildingVertex,
): string {
  const keys = [coordinateKey(start), coordinateKey(end)].sort(compareStrings);
  return `${keys[0]}|${keys[1]}`;
}

function compareOutgoingHalfEdges(
  left: HalfEdge,
  right: HalfEdge,
  vertices: Record<string, BuildingVertex>,
): number {
  const origin = vertices[left.from];
  const leftTarget = vertices[left.to];
  const rightTarget = vertices[right.to];
  const safeIntegerCoordinates = [
    origin.x_mm,
    origin.y_mm,
    leftTarget.x_mm,
    leftTarget.y_mm,
    rightTarget.x_mm,
    rightTarget.y_mm,
  ].every(Number.isSafeInteger);

  let directionOrder = 0;
  let distanceOrder = 0;
  if (safeIntegerCoordinates) {
    const originX = BigInt(origin.x_mm);
    const originY = BigInt(origin.y_mm);
    const leftDx = BigInt(leftTarget.x_mm) - originX;
    const leftDy = BigInt(leftTarget.y_mm) - originY;
    const rightDx = BigInt(rightTarget.x_mm) - originX;
    const rightDy = BigInt(rightTarget.y_mm) - originY;
    const leftHalf = leftDy > 0n || (leftDy === 0n && leftDx >= 0n) ? 0 : 1;
    const rightHalf =
      rightDy > 0n || (rightDy === 0n && rightDx >= 0n) ? 0 : 1;
    if (leftHalf !== rightHalf) {
      directionOrder = leftHalf - rightHalf;
    } else {
      const cross = leftDx * rightDy - leftDy * rightDx;
      if (cross !== 0n) directionOrder = cross > 0n ? -1 : 1;
    }
    if (directionOrder === 0) {
      const leftDistance = leftDx * leftDx + leftDy * leftDy;
      const rightDistance = rightDx * rightDx + rightDy * rightDy;
      distanceOrder =
        leftDistance < rightDistance ? -1 : leftDistance > rightDistance ? 1 : 0;
    }
  } else {
    const leftDx = leftTarget.x_mm - origin.x_mm;
    const leftDy = leftTarget.y_mm - origin.y_mm;
    const rightDx = rightTarget.x_mm - origin.x_mm;
    const rightDy = rightTarget.y_mm - origin.y_mm;
    const leftHalf = leftDy > 0 || (leftDy === 0 && leftDx >= 0) ? 0 : 1;
    const rightHalf = rightDy > 0 || (rightDy === 0 && rightDx >= 0) ? 0 : 1;
    if (leftHalf !== rightHalf) {
      directionOrder = leftHalf - rightHalf;
    } else {
      const cross = leftDx * rightDy - leftDy * rightDx;
      if (cross !== 0) directionOrder = cross > 0 ? -1 : 1;
    }
    if (directionOrder === 0) {
      distanceOrder =
        Math.hypot(leftDx, leftDy) - Math.hypot(rightDx, rightDy);
    }
  }

  return (
    directionOrder ||
    distanceOrder ||
    compareVertexIds(left.to, right.to, vertices) ||
    compareStrings(left.key, right.key)
  );
}

function validEndpoint(
  vertices: Record<string, BuildingVertex>,
  vertexId: string,
): BuildingVertex | undefined {
  const vertex = vertices[vertexId];
  if (
    !vertex ||
    !Number.isFinite(vertex.x_mm) ||
    !Number.isFinite(vertex.y_mm)
  ) {
    return undefined;
  }
  return vertex;
}

function createHalfEdges(
  vertices: Record<string, BuildingVertex>,
  walls: Record<string, BuildingWall>,
): HalfEdge[] {
  const edges: HalfEdge[] = [];
  const seenGeometry = new Set<string>();

  for (const [wallId, wall] of Object.entries(walls).sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    const start = validEndpoint(vertices, wall.start_vertex_id);
    const end = validEndpoint(vertices, wall.end_vertex_id);
    if (
      !start ||
      !end ||
      (start.x_mm === end.x_mm && start.y_mm === end.y_mm)
    ) {
      continue;
    }

    const geometryKey = undirectedCoordinateKey(start, end);
    if (seenGeometry.has(geometryKey)) continue;
    seenGeometry.add(geometryKey);

    const forwardKey = `${wallId}:0`;
    const reverseKey = `${wallId}:1`;
    edges.push(
      {
        key: forwardKey,
        from: wall.start_vertex_id,
        to: wall.end_vertex_id,
        twinKey: reverseKey,
      },
      {
        key: reverseKey,
        from: wall.end_vertex_id,
        to: wall.start_vertex_id,
        twinKey: forwardKey,
      },
    );
  }
  return edges;
}

function signedDoubleArea(
  boundary: string[],
  vertices: Record<string, BuildingVertex>,
): number {
  const points = boundary.map((vertexId) => vertices[vertexId]);
  if (points.some((point) => !point)) return Number.NaN;
  return polygonSignedDoubleArea(points);
}

function rotateToStableStart(
  boundary: string[],
  vertices: Record<string, BuildingVertex>,
): string[] {
  let startIndex = 0;
  for (let index = 1; index < boundary.length; index += 1) {
    if (compareVertexIds(boundary[index], boundary[startIndex], vertices) < 0) {
      startIndex = index;
    }
  }
  return boundary.slice(startIndex).concat(boundary.slice(0, startIndex));
}

function canonicalFaceBoundary(
  boundary: string[],
  vertices: Record<string, BuildingVertex>,
): string[] {
  const oriented =
    signedDoubleArea(boundary, vertices) < 0 ? [...boundary].reverse() : boundary;
  return rotateToStableStart(oriented, vertices);
}

function splitAtRepeatedVertices(boundary: string[]): string[][] {
  const pending = [boundary];
  const simple: string[][] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const firstIndex = new Map<string, number>();
    let split: [number, number] | undefined;
    for (let index = 0; index < current.length; index += 1) {
      const previousIndex = firstIndex.get(current[index]);
      if (previousIndex !== undefined) {
        split = [previousIndex, index];
        break;
      }
      firstIndex.set(current[index], index);
    }
    if (!split) {
      if (current.length >= 3) simple.push(current);
      continue;
    }
    const [start, end] = split;
    pending.push(
      current.slice(start, end),
      current.slice(end).concat(current.slice(0, start)),
    );
  }
  return simple;
}

function removeCollinearPoints(points: BuildingVertex[]): BuildingVertex[] {
  let result = [...points];
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    const kept: BuildingVertex[] = [];
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
    if (kept.length < 3) return kept;
    result = kept;
  }
  return result;
}

function minimumCycleSignature(points: BuildingVertex[]): string {
  if (points.length < 3) return '';
  const tokens = points.map(coordinateKey);
  const candidates: string[] = [];
  for (const oriented of [tokens, [...tokens].reverse()]) {
    for (let index = 0; index < oriented.length; index += 1) {
      candidates.push(
        oriented.slice(index).concat(oriented.slice(0, index)).join('|'),
      );
    }
  }
  candidates.sort(compareStrings);
  return candidates[0];
}

/**
 * Returns a coordinate-only cycle signature. Rotation, winding, vertex IDs, and
 * collinear points introduced by wall splitting do not affect the result.
 */
export function geometryBoundarySignature(
  boundaryVertexIds: string[],
  vertices: Record<string, BuildingVertex>,
): string {
  const points: BuildingVertex[] = [];
  for (const vertexId of boundaryVertexIds) {
    const vertex = validEndpoint(vertices, vertexId);
    if (!vertex) return '';
    const previous = points.at(-1);
    if (
      !previous ||
      previous.x_mm !== vertex.x_mm ||
      previous.y_mm !== vertex.y_mm
    ) {
      points.push(vertex);
    }
  }
  if (
    points.length > 1 &&
    points[0].x_mm === points.at(-1)?.x_mm &&
    points[0].y_mm === points.at(-1)?.y_mm
  ) {
    points.pop();
  }
  return minimumCycleSignature(removeCollinearPoints(points));
}

/**
 * Derives simple bounded point-rings from a normalized planar wall graph.
 * Malformed, zero-length, and duplicate geometric edges are ignored.
 */
export function deriveFaces(input: FaceGraph): DerivedFace[] {
  const halfEdges = createHalfEdges(input.vertices, input.walls);
  const byKey = new Map(halfEdges.map((edge) => [edge.key, edge]));
  const outgoing = new Map<string, HalfEdge[]>();
  for (const edge of halfEdges) {
    const entries = outgoing.get(edge.from) ?? [];
    entries.push(edge);
    outgoing.set(edge.from, entries);
  }
  for (const entries of outgoing.values()) {
    entries.sort((left, right) =>
      compareOutgoingHalfEdges(left, right, input.vertices),
    );
  }

  const nextByKey = new Map<string, string>();
  for (const edge of halfEdges) {
    const atDestination = outgoing.get(edge.to);
    if (!atDestination?.length) continue;
    const twinIndex = atDestination.findIndex(
      (candidate) => candidate.key === edge.twinKey,
    );
    if (twinIndex < 0) continue;
    const nextIndex =
      (twinIndex - 1 + atDestination.length) % atDestination.length;
    nextByKey.set(edge.key, atDestination[nextIndex].key);
  }

  const consumed = new Set<string>();
  const faces: DerivedFace[] = [];
  const seenFaces = new Set<string>();
  for (const start of [...halfEdges].sort((left, right) =>
    compareStrings(left.key, right.key),
  )) {
    if (consumed.has(start.key)) continue;
    const walkedKeys: string[] = [];
    const local = new Set<string>();
    let currentKey: string | undefined = start.key;

    while (currentKey && !local.has(currentKey) && walkedKeys.length <= halfEdges.length) {
      local.add(currentKey);
      walkedKeys.push(currentKey);
      currentKey = nextByKey.get(currentKey);
    }
    walkedKeys.forEach((key) => consumed.add(key));
    if (currentKey !== start.key || walkedKeys.length < 3) continue;

    const boundary = walkedKeys.map((key) => byKey.get(key)?.from ?? '');
    if (boundary.some((vertexId) => !vertexId)) continue;
    for (const simpleBoundary of splitAtRepeatedVertices(boundary)) {
      const doubleArea = signedDoubleArea(simpleBoundary, input.vertices);
      if (!Number.isFinite(doubleArea) || doubleArea <= 0) continue;
      const canonical = canonicalFaceBoundary(simpleBoundary, input.vertices);
      const signature = geometryBoundarySignature(canonical, input.vertices);
      if (!signature || seenFaces.has(signature)) continue;
      seenFaces.add(signature);
      faces.push({
        boundary_vertex_ids: canonical,
        area_mm2: Math.round(Math.abs(doubleArea) / 2),
      });
    }
  }

  return faces.sort((left, right) => {
    const signatureOrder = compareStrings(
      geometryBoundarySignature(left.boundary_vertex_ids, input.vertices),
      geometryBoundarySignature(right.boundary_vertex_ids, input.vertices),
    );
    return (
      signatureOrder ||
      compareStrings(
        left.boundary_vertex_ids.join('|'),
        right.boundary_vertex_ids.join('|'),
      )
    );
  });
}
