import type {
  BuildingDocument,
  BuildingVertex,
  BuildingWall,
} from '../domain/buildingTypes.ts';
import {
  intersectSegments,
  type MillimeterPoint,
} from './segmentIntersection.ts';

export interface WallCandidate
  extends Omit<BuildingWall, 'start_vertex_id' | 'end_vertex_id'> {
  start: BuildingVertex;
  end: BuildingVertex;
  floor_id?: string;
}

export type InsertWallFailureCode =
  | 'ZERO_LENGTH'
  | 'DUPLICATE_EDGE'
  | 'COLLINEAR_OVERLAP'
  | 'ELEMENT_SPANS_SPLIT';

export type TopologyResult =
  | {
      ok: true;
      document: BuildingDocument;
      /** IDs of segments created from the insertWall candidate; always [] for normalizeGraph. */
      createdWallIds: string[];
      /** Original-to-canonical vertex IDs, populated by normalizeGraph. */
      canonicalVertexIds?: Record<string, string>;
    }
  | {
      ok: false;
      code: InsertWallFailureCode;
      conflictingWallIds: string[];
    };

export type InsertWallResult = TopologyResult;

interface SplitPoint {
  point: BuildingVertex;
  vertexId?: string;
}

interface EndpointAnchor {
  key: string;
  point: BuildingVertex;
  vertexId?: string;
}

interface InsertIntersectionEvent {
  wallId: string;
  tCandidate: number;
  tWall: number;
  point: MillimeterPoint;
  anchors: EndpointAnchor[];
}

interface GraphIntersectionEvent {
  leftWallId: string;
  rightWallId: string;
  tLeft: number;
  tRight: number;
  point: MillimeterPoint;
  anchors: EndpointAnchor[];
}

interface ClusterRepresentative {
  point: BuildingVertex;
  vertexId?: string;
}

interface IdAllocator {
  nextVertex(): string;
  nextWall(): string;
}

function distance(a: MillimeterPoint, b: MillimeterPoint): number {
  return Math.hypot(a.x_mm - b.x_mm, a.y_mm - b.y_mm);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rounded(point: MillimeterPoint): BuildingVertex {
  return {
    x_mm: Math.round(point.x_mm),
    y_mm: Math.round(point.y_mm),
  };
}

function segmentParameter(
  point: MillimeterPoint,
  start: MillimeterPoint,
  end: MillimeterPoint,
): number {
  const dx = end.x_mm - start.x_mm;
  const dy = end.y_mm - start.y_mm;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  return (
    ((point.x_mm - start.x_mm) * dx + (point.y_mm - start.y_mm) * dy) /
    lengthSquared
  );
}

function makeIdAllocator(document: BuildingDocument): IdAllocator {
  const vertexIds = new Set(Object.keys(document.vertices));
  const wallIds = new Set(Object.keys(document.walls));
  let vertexCounter = maximumNumericId(vertexIds, 'v');
  let wallCounter = maximumNumericId(wallIds, 'w');

  return {
    nextVertex(): string {
      let id: string;
      do {
        vertexCounter += 1n;
        id = `v_${String(vertexCounter).padStart(4, '0')}`;
      } while (vertexIds.has(id));
      vertexIds.add(id);
      return id;
    },
    nextWall(): string {
      let id: string;
      do {
        wallCounter += 1n;
        id = `w_${String(wallCounter).padStart(4, '0')}`;
      } while (wallIds.has(id));
      wallIds.add(id);
      return id;
    },
  };
}

function maximumNumericId(ids: Set<string>, prefix: 'v' | 'w'): bigint {
  let maximum = 0n;
  for (const id of ids) {
    const match = id.match(new RegExp(`^${prefix}_(\\d+)$`));
    if (match) {
      const value = BigInt(match[1]);
      if (value > maximum) maximum = value;
    }
  }
  return maximum;
}

function theoreticalIntersectionPoint(
  aStart: MillimeterPoint,
  aEnd: MillimeterPoint,
  bStart: MillimeterPoint,
  bEnd: MillimeterPoint,
): MillimeterPoint | undefined {
  const rX = aEnd.x_mm - aStart.x_mm;
  const rY = aEnd.y_mm - aStart.y_mm;
  const sX = bEnd.x_mm - bStart.x_mm;
  const sY = bEnd.y_mm - bStart.y_mm;
  const denominator = rX * sY - rY * sX;
  if (denominator === 0) return undefined;
  const qMinusPX = bStart.x_mm - aStart.x_mm;
  const qMinusPY = bStart.y_mm - aStart.y_mm;
  const t = (qMinusPX * sY - qMinusPY * sX) / denominator;
  return {
    x_mm: aStart.x_mm + t * rX,
    y_mm: aStart.y_mm + t * rY,
  };
}

/**
 * Clusters raw double-precision topology events before persistence rounding.
 * Union-find makes tolerance grouping transitive, while the lexicographically
 * smallest raw point gives each cluster an order-independent representative.
 */
function clusterIntersectionEvents(
  events: Array<{ point: MillimeterPoint; anchors: EndpointAnchor[] }>,
  toleranceMm: number,
): ClusterRepresentative[] {
  const parents = events.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };

  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) parents[rightRoot] = leftRoot;
    else parents[leftRoot] = rightRoot;
  };

  for (let left = 0; left < events.length; left += 1) {
    for (let right = left + 1; right < events.length; right += 1) {
      if (distance(events[left].point, events[right].point) <= toleranceMm) {
        union(left, right);
      }
    }
  }

  const firstEventByAnchorKey = new Map<string, number>();
  const anchorCounts = new Map<string, number>();
  for (let index = 0; index < events.length; index += 1) {
    for (const anchor of events[index].anchors) {
      anchorCounts.set(anchor.key, (anchorCounts.get(anchor.key) ?? 0) + 1);
      const firstEvent = firstEventByAnchorKey.get(anchor.key);
      if (firstEvent === undefined) {
        firstEventByAnchorKey.set(anchor.key, index);
      } else {
        union(firstEvent, index);
      }
    }
  }

  const memberIndexesByRoot = new Map<number, number[]>();
  for (let index = 0; index < events.length; index += 1) {
    const root = find(index);
    const members = memberIndexesByRoot.get(root) ?? [];
    members.push(index);
    memberIndexesByRoot.set(root, members);
  }

  const representativeByRoot = new Map<number, ClusterRepresentative>();
  for (const [root, memberIndexes] of memberIndexesByRoot) {
    const repeatedAnchors = memberIndexes
      .flatMap((index) => events[index].anchors)
      .filter((anchor) => (anchorCounts.get(anchor.key) ?? 0) > 1)
      .sort(
        (left, right) =>
          compareStrings(left.key, right.key) ||
          left.point.x_mm - right.point.x_mm ||
          left.point.y_mm - right.point.y_mm ||
          compareStrings(left.vertexId ?? '', right.vertexId ?? ''),
      );
    if (repeatedAnchors.length > 0) {
      const anchor = repeatedAnchors[0];
      representativeByRoot.set(root, {
        point: anchor.point,
        vertexId: anchor.vertexId,
      });
      continue;
    }

    const representative = memberIndexes
      .map((index) => events[index].point)
      .sort(
        (left, right) =>
          left.x_mm - right.x_mm || left.y_mm - right.y_mm,
      )[0];
    representativeByRoot.set(root, { point: rounded(representative) });
  }

  return events.map((_, index) => representativeByRoot.get(find(index))!);
}

function endpointAnchor(
  key: string,
  t: number,
  start: BuildingVertex,
  end: BuildingVertex,
  startVertexId?: string,
  endVertexId?: string,
): EndpointAnchor[] {
  if (t === 0) {
    return [{ key: `${key}:start`, point: start, vertexId: startVertexId }];
  }
  if (t === 1) {
    return [{ key: `${key}:end`, point: end, vertexId: endVertexId }];
  }
  return [];
}

function closestVertexId(
  vertices: Record<string, BuildingVertex>,
  point: MillimeterPoint,
  toleranceMm: number,
): string | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const [id, vertex] of Object.entries(vertices)) {
    const candidateDistance = distance(vertex, point);
    if (candidateDistance > toleranceMm) continue;
    if (
      !best ||
      candidateDistance < best.distance ||
      (candidateDistance === best.distance && id < best.id)
    ) {
      best = { id, distance: candidateDistance };
    }
  }
  return best?.id;
}

function ensureVertex(
  document: BuildingDocument,
  allocator: IdAllocator,
  point: MillimeterPoint,
  toleranceMm: number,
  preferredId?: string,
): string {
  if (preferredId && document.vertices[preferredId]) return preferredId;
  const existingId = closestVertexId(document.vertices, point, toleranceMm);
  if (existingId) return existingId;
  const id = allocator.nextVertex();
  document.vertices[id] = rounded(point);
  return id;
}

function sameUndirectedEdge(
  aStart: MillimeterPoint,
  aEnd: MillimeterPoint,
  bStart: MillimeterPoint,
  bEnd: MillimeterPoint,
  toleranceMm: number,
): boolean {
  return (
    (distance(aStart, bStart) <= toleranceMm &&
      distance(aEnd, bEnd) <= toleranceMm) ||
    (distance(aStart, bEnd) <= toleranceMm &&
      distance(aEnd, bStart) <= toleranceMm)
  );
}

function uniqueSortedPoints(
  points: SplitPoint[],
  start: MillimeterPoint,
  end: MillimeterPoint,
  toleranceMm: number,
): SplitPoint[] {
  const segmentLength = distance(start, end);
  const sorted = [...points].sort(
    (left, right) =>
      segmentParameter(left.point, start, end) -
      segmentParameter(right.point, start, end),
  );
  const unique: SplitPoint[] = [];
  for (const entry of sorted) {
    const previous = unique.at(-1);
    const samePositionAlongSegment =
      previous !== undefined &&
      Math.abs(
        segmentParameter(entry.point, start, end) -
          segmentParameter(previous.point, start, end),
      ) *
        segmentLength <=
        toleranceMm;
    if (
      previous &&
      ((entry.vertexId !== undefined &&
        entry.vertexId === previous.vertexId) ||
        distance(entry.point, previous.point) <= toleranceMm ||
        samePositionAlongSegment)
    ) {
      if (!previous.vertexId && entry.vertexId) {
        previous.vertexId = entry.vertexId;
        previous.point = entry.point;
      }
      continue;
    }
    unique.push({ ...entry, point: rounded(entry.point) });
  }
  return unique;
}

function replaceFloorWallReference(
  document: BuildingDocument,
  originalWallId: string,
  replacementWallIds: string[],
): void {
  for (const floor of document.floors) {
    floor.wall_ids = floor.wall_ids.flatMap((wallId) =>
      wallId === originalWallId ? replacementWallIds : [wallId],
    );
  }
}

function splitExistingWalls(
  document: BuildingDocument,
  splitPointsByWall: Map<string, SplitPoint[]>,
  allocator: IdAllocator,
  toleranceMm: number,
): Extract<TopologyResult, { ok: false }> | undefined {
  for (const [wallId, splitPoints] of splitPointsByWall) {
    const wall = document.walls[wallId];
    if (!wall) continue;
    const start = document.vertices[wall.start_vertex_id];
    const end = document.vertices[wall.end_vertex_id];
    if (!start || !end) continue;

    const points = uniqueSortedPoints(
      [
        { point: start, vertexId: wall.start_vertex_id },
        ...splitPoints,
        { point: end, vertexId: wall.end_vertex_id },
      ],
      start,
      end,
      toleranceMm,
    );
    if (points.length <= 2) continue;

    const vertexIds = points.map((entry) =>
      ensureVertex(
        document,
        allocator,
        entry.point,
        toleranceMm,
        entry.vertexId,
      ),
    );
    const replacementIds: string[] = [];
    for (let index = 0; index < vertexIds.length - 1; index += 1) {
      if (vertexIds[index] === vertexIds[index + 1]) continue;
      const childId = allocator.nextWall();
      document.walls[childId] = {
        ...wall,
        start_vertex_id: vertexIds[index],
        end_vertex_id: vertexIds[index + 1],
      };
      replacementIds.push(childId);
    }
    const rehostFailure = rehostWallElements(
      document,
      wallId,
      replacementIds,
      toleranceMm,
    );
    if (rehostFailure) return rehostFailure;
    delete document.walls[wallId];
    replaceFloorWallReference(document, wallId, replacementIds);
  }
  return undefined;
}

function rehostWallElements(
  document: BuildingDocument,
  originalWallId: string,
  childWallIds: string[],
  toleranceMm: number,
): Extract<TopologyResult, { ok: false }> | undefined {
  const originalWall = document.walls[originalWallId];
  const originalEndpoints = originalWall
    ? wallEndpoints(document, originalWall)
    : undefined;
  if (!originalEndpoints) {
    return {
      ok: false,
      code: 'ELEMENT_SPANS_SPLIT',
      conflictingWallIds: [originalWallId],
    };
  }
  const [originalStart, originalEnd] = originalEndpoints;
  const originalLength = distance(originalStart, originalEnd);
  const originalUnit = {
    x: (originalEnd.x_mm - originalStart.x_mm) / originalLength,
    y: (originalEnd.y_mm - originalStart.y_mm) / originalLength,
  };
  const originalArc = (point: BuildingVertex) =>
    (point.x_mm - originalStart.x_mm) * originalUnit.x +
    (point.y_mm - originalStart.y_mm) * originalUnit.y;
  const children = childWallIds.map((id) => {
    const wall = document.walls[id];
    const endpoints = wall ? wallEndpoints(document, wall) : undefined;
    const length = endpoints ? distance(endpoints[0], endpoints[1]) : 0;
    const startArc = endpoints ? originalArc(endpoints[0]) : 0;
    const endArc = endpoints ? originalArc(endpoints[1]) : 0;
    return {
      id,
      endpoints,
      length,
      startArc,
      endArc,
      minimumArc: Math.min(startArc, endArc),
      maximumArc: Math.max(startArc, endArc),
    };
  }).sort((left, right) => left.minimumArc - right.minimumArc);
  for (const element of Object.values(document.wall_elements)) {
    if (element.host_wall_id !== originalWallId) continue;
    const elementStart = element.offset_from_start_mm;
    const elementEnd = elementStart + element.width_mm;
    const child = children.find(
      (candidate) =>
        elementStart >= candidate.minimumArc - toleranceMm &&
        elementEnd <= candidate.maximumArc + toleranceMm,
    );
    if (!child || !child.endpoints || child.length <= 0) {
      return {
        ok: false,
        code: 'ELEMENT_SPANS_SPLIT',
        conflictingWallIds: [originalWallId],
      };
    }
    const childStart = child.endpoints[0];
    const childEnd = child.endpoints[1];
    const childUnit = {
      x: (childEnd.x_mm - childStart.x_mm) / child.length,
      y: (childEnd.y_mm - childStart.y_mm) / child.length,
    };
    const edgeArc =
      child.startArc <= child.endArc ? elementStart : elementEnd;
    const edgeWorld = {
      x_mm: originalStart.x_mm + originalUnit.x * edgeArc,
      y_mm: originalStart.y_mm + originalUnit.y * edgeArc,
    };
    const projectedOffset =
      (edgeWorld.x_mm - childStart.x_mm) * childUnit.x +
      (edgeWorld.y_mm - childStart.y_mm) * childUnit.y;
    element.host_wall_id = child.id;
    element.offset_from_start_mm = Math.max(
      0,
      Math.min(
        Math.round(projectedOffset),
        Math.round(child.length - element.width_mm),
      ),
    );
  }
  return undefined;
}

function removeUnreferencedVertices(document: BuildingDocument): void {
  const referenced = new Set<string>();
  for (const wall of Object.values(document.walls)) {
    referenced.add(wall.start_vertex_id);
    referenced.add(wall.end_vertex_id);
  }
  for (const face of Object.values(document.faces)) {
    face.boundary_vertex_ids.forEach((id) => referenced.add(id));
  }
  for (const region of Object.values(document.outside_regions)) {
    region.boundary_vertex_ids.forEach((id) => referenced.add(id));
  }
  for (const vertexId of Object.keys(document.vertices)) {
    if (!referenced.has(vertexId)) delete document.vertices[vertexId];
  }
}

function wallEndpoints(
  document: BuildingDocument,
  wall: BuildingWall,
): [BuildingVertex, BuildingVertex] | undefined {
  const start = document.vertices[wall.start_vertex_id];
  const end = document.vertices[wall.end_vertex_id];
  return start && end ? [start, end] : undefined;
}

function failure(
  code: InsertWallFailureCode,
  conflictingWallIds: string[] = [],
): TopologyResult {
  return { ok: false, code, conflictingWallIds };
}

function findInvalidTopology(
  document: BuildingDocument,
  toleranceMm: number,
): Extract<TopologyResult, { ok: false }> | undefined {
  const wallEntries = Object.entries(document.walls);
  for (const [wallId, wall] of wallEntries) {
    const endpoints = wallEndpoints(document, wall);
    if (!endpoints || distance(endpoints[0], endpoints[1]) <= toleranceMm) {
      return {
        ok: false,
        code: 'ZERO_LENGTH',
        conflictingWallIds: [wallId],
      };
    }
  }

  for (let leftIndex = 0; leftIndex < wallEntries.length; leftIndex += 1) {
    const [leftId, leftWall] = wallEntries[leftIndex];
    const leftEndpoints = wallEndpoints(document, leftWall);
    if (!leftEndpoints) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < wallEntries.length;
      rightIndex += 1
    ) {
      const [rightId, rightWall] = wallEntries[rightIndex];
      const rightEndpoints = wallEndpoints(document, rightWall);
      if (!rightEndpoints) continue;
      if (
        sameUndirectedEdge(
          leftEndpoints[0],
          leftEndpoints[1],
          rightEndpoints[0],
          rightEndpoints[1],
          toleranceMm,
        )
      ) {
        return {
          ok: false,
          code: 'DUPLICATE_EDGE',
          conflictingWallIds: [leftId, rightId],
        };
      }
      if (
        intersectSegments(
          leftEndpoints[0],
          leftEndpoints[1],
          rightEndpoints[0],
          rightEndpoints[1],
          toleranceMm,
        ).kind === 'overlap'
      ) {
        return {
          ok: false,
          code: 'COLLINEAR_OVERLAP',
          conflictingWallIds: [leftId, rightId],
        };
      }
    }
  }
  return undefined;
}

/**
 * Inserts a wall into a cloned document and normalizes every touched junction.
 * The input document is never mutated, including on validation failures.
 */
export function insertWall(
  document: BuildingDocument,
  candidate: WallCandidate,
  toleranceMm = 1,
): InsertWallResult {
  const candidateStart = rounded(candidate.start);
  const candidateEnd = rounded(candidate.end);
  const snappedStartId = closestVertexId(
    document.vertices,
    candidateStart,
    toleranceMm,
  );
  const snappedEndId = closestVertexId(
    document.vertices,
    candidateEnd,
    toleranceMm,
  );
  const start = snappedStartId
    ? document.vertices[snappedStartId]
    : candidateStart;
  const end = snappedEndId ? document.vertices[snappedEndId] : candidateEnd;

  if (distance(start, end) <= toleranceMm) return failure('ZERO_LENGTH');

  const duplicateWallIds: string[] = [];
  const overlappingWallIds: string[] = [];
  for (const [wallId, wall] of Object.entries(document.walls)) {
    const endpoints = wallEndpoints(document, wall);
    if (!endpoints) continue;
    if (
      sameUndirectedEdge(
        start,
        end,
        endpoints[0],
        endpoints[1],
        toleranceMm,
      )
    ) {
      duplicateWallIds.push(wallId);
      continue;
    }
    if (
      intersectSegments(
        candidateStart,
        candidateEnd,
        endpoints[0],
        endpoints[1],
        toleranceMm,
      ).kind === 'overlap'
    ) {
      overlappingWallIds.push(wallId);
    }
  }
  if (duplicateWallIds.length > 0) {
    return failure('DUPLICATE_EDGE', duplicateWallIds);
  }
  if (overlappingWallIds.length > 0) {
    return failure('COLLINEAR_OVERLAP', overlappingWallIds);
  }

  const next = structuredClone(document);
  const allocator = makeIdAllocator(next);
  const splitPointsByWall = new Map<string, SplitPoint[]>();
  const candidatePoints: SplitPoint[] = [
    { point: start, vertexId: snappedStartId },
    { point: end, vertexId: snappedEndId },
  ];
  const intersectionEvents: InsertIntersectionEvent[] = [];

  for (const [wallId, wall] of Object.entries(document.walls)) {
    const endpoints = wallEndpoints(document, wall);
    if (!endpoints) continue;
    const intersection = intersectSegments(
      start,
      end,
      endpoints[0],
      endpoints[1],
      toleranceMm,
    );
    if (intersection.kind !== 'point') continue;

    const point =
      theoreticalIntersectionPoint(start, end, endpoints[0], endpoints[1]) ??
      intersection.point;
    intersectionEvents.push({
      wallId,
      tCandidate: intersection.tA,
      tWall: intersection.tB,
      point,
      anchors: [
        ...endpointAnchor(
          'candidate',
          intersection.tA,
          start,
          end,
          snappedStartId,
          snappedEndId,
        ),
        ...endpointAnchor(
          `wall:${wallId}`,
          intersection.tB,
          endpoints[0],
          endpoints[1],
          wall.start_vertex_id,
          wall.end_vertex_id,
        ),
      ],
    });
  }

  const eventRepresentatives = clusterIntersectionEvents(
    intersectionEvents,
    toleranceMm,
  );
  for (let index = 0; index < intersectionEvents.length; index += 1) {
    const event = intersectionEvents[index];
    const representative = eventRepresentatives[index];
    const canonicalVertexId = ensureVertex(
      next,
      allocator,
      representative.point,
      0,
      representative.vertexId,
    );
    const point = next.vertices[canonicalVertexId];
    const candidateSplitPoint = { point, vertexId: canonicalVertexId };
    if (event.tCandidate === 0) {
      candidatePoints[0] = candidateSplitPoint;
    } else if (event.tCandidate === 1) {
      candidatePoints[1] = candidateSplitPoint;
    } else {
      candidatePoints.push(candidateSplitPoint);
    }

    if (event.tWall > 0 && event.tWall < 1) {
      const points = splitPointsByWall.get(event.wallId) ?? [];
      points.push({ point, vertexId: canonicalVertexId });
      splitPointsByWall.set(event.wallId, points);
    } else {
      const nextWall = next.walls[event.wallId];
      if (event.tWall === 0) {
        nextWall.start_vertex_id = canonicalVertexId;
      }
      if (event.tWall === 1) {
        nextWall.end_vertex_id = canonicalVertexId;
      }
    }
  }

  const normalizedCandidateStart = candidatePoints[0];
  const normalizedCandidateEnd = candidatePoints[1];
  if (
    (normalizedCandidateStart.vertexId !== undefined &&
      normalizedCandidateStart.vertexId === normalizedCandidateEnd.vertexId) ||
    distance(
      normalizedCandidateStart.point,
      normalizedCandidateEnd.point,
    ) <= toleranceMm
  ) {
    return failure('ZERO_LENGTH');
  }

  const splitFailure = splitExistingWalls(next, splitPointsByWall, allocator, toleranceMm);
  if (splitFailure) return splitFailure;

  const orderedCandidatePoints = uniqueSortedPoints(
    candidatePoints,
    start,
    end,
    toleranceMm,
  );
  const candidateVertexIds = orderedCandidatePoints.map((entry) =>
    ensureVertex(
      next,
      allocator,
      entry.point,
      toleranceMm,
      entry.vertexId,
    ),
  );
  const createdWallIds: string[] = [];
  for (let index = 0; index < candidateVertexIds.length - 1; index += 1) {
    const startVertexId = candidateVertexIds[index];
    const endVertexId = candidateVertexIds[index + 1];
    if (startVertexId === endVertexId) continue;
    const wallId = allocator.nextWall();
    next.walls[wallId] = {
      start_vertex_id: startVertexId,
      end_vertex_id: endVertexId,
      wall_type: candidate.wall_type,
      thickness_mm: candidate.thickness_mm,
      height_mm: candidate.height_mm,
      material_type: candidate.material_type,
      ...(candidate.notes === undefined ? {} : { notes: candidate.notes }),
    };
    createdWallIds.push(wallId);
  }

  const floor =
    next.floors.find((entry) => entry.floor_id === candidate.floor_id) ??
    next.floors[0];
  floor.wall_ids.push(...createdWallIds);
  removeUnreferencedVertices(next);
  return { ok: true, document: next, createdWallIds };
}

/**
 * Normalizes crossings and coincident vertices already present in a document.
 * Invalid zero, duplicate, or overlapping edges return a typed failure result.
 */
export function normalizeGraph(
  document: BuildingDocument,
  toleranceMm = 1,
): TopologyResult {
  const next = structuredClone(document);
  for (const vertex of Object.values(next.vertices)) {
    vertex.x_mm = Math.round(vertex.x_mm);
    vertex.y_mm = Math.round(vertex.y_mm);
  }
  const rawFailure = findInvalidTopology(next, toleranceMm);
  if (rawFailure) return rawFailure;

  const allocator = makeIdAllocator(next);
  const canonicalVertices: Record<string, BuildingVertex> = {};
  const canonicalIdByOriginal = new Map<string, string>();

  for (const vertexId of Object.keys(next.vertices).sort()) {
    const point = rounded(next.vertices[vertexId]);
    const canonicalId = closestVertexId(
      canonicalVertices,
      point,
      toleranceMm,
    );
    if (canonicalId) {
      canonicalIdByOriginal.set(vertexId, canonicalId);
    } else {
      canonicalVertices[vertexId] = point;
      canonicalIdByOriginal.set(vertexId, vertexId);
    }
  }
  next.vertices = canonicalVertices;
  for (const wall of Object.values(next.walls)) {
    wall.start_vertex_id =
      canonicalIdByOriginal.get(wall.start_vertex_id) ?? wall.start_vertex_id;
    wall.end_vertex_id =
      canonicalIdByOriginal.get(wall.end_vertex_id) ?? wall.end_vertex_id;
  }

  const canonicalFailure = findInvalidTopology(next, toleranceMm);
  if (canonicalFailure) return canonicalFailure;

  const wallEntries = Object.entries(next.walls);
  const splitPointsByWall = new Map<string, SplitPoint[]>();
  const intersectionEvents: GraphIntersectionEvent[] = [];
  for (let leftIndex = 0; leftIndex < wallEntries.length; leftIndex += 1) {
    const [leftId, leftWall] = wallEntries[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < wallEntries.length;
      rightIndex += 1
    ) {
      const leftEndpoints = wallEndpoints(next, leftWall);
      if (!leftEndpoints) continue;
      const [rightId, rightWall] = wallEntries[rightIndex];
      const rightEndpoints = wallEndpoints(next, rightWall);
      if (!rightEndpoints) continue;

      const intersection = intersectSegments(
        leftEndpoints[0],
        leftEndpoints[1],
        rightEndpoints[0],
        rightEndpoints[1],
        toleranceMm,
      );
      if (intersection.kind !== 'point') continue;

      const point =
        theoreticalIntersectionPoint(
          leftEndpoints[0],
          leftEndpoints[1],
          rightEndpoints[0],
          rightEndpoints[1],
        ) ?? intersection.point;
      intersectionEvents.push({
        leftWallId: leftId,
        rightWallId: rightId,
        tLeft: intersection.tA,
        tRight: intersection.tB,
        point,
        anchors: [
          ...endpointAnchor(
            `wall:${leftId}`,
            intersection.tA,
            leftEndpoints[0],
            leftEndpoints[1],
            leftWall.start_vertex_id,
            leftWall.end_vertex_id,
          ),
          ...endpointAnchor(
            `wall:${rightId}`,
            intersection.tB,
            rightEndpoints[0],
            rightEndpoints[1],
            rightWall.start_vertex_id,
            rightWall.end_vertex_id,
          ),
        ],
      });
    }
  }

  const eventRepresentatives = clusterIntersectionEvents(
    intersectionEvents,
    toleranceMm,
  );
  for (let index = 0; index < intersectionEvents.length; index += 1) {
    const event = intersectionEvents[index];
    const leftWall = next.walls[event.leftWallId];
    const rightWall = next.walls[event.rightWallId];
    const representative = eventRepresentatives[index];
    if (!leftWall || !rightWall) continue;
    const canonicalVertexId = ensureVertex(
      next,
      allocator,
      representative.point,
      0,
      representative.vertexId,
    );
    const point = next.vertices[canonicalVertexId];
    if (event.tLeft === 0) leftWall.start_vertex_id = canonicalVertexId;
    if (event.tLeft === 1) leftWall.end_vertex_id = canonicalVertexId;
    if (event.tRight === 0) rightWall.start_vertex_id = canonicalVertexId;
    if (event.tRight === 1) rightWall.end_vertex_id = canonicalVertexId;
    if (event.tLeft > 0 && event.tLeft < 1) {
      const points = splitPointsByWall.get(event.leftWallId) ?? [];
      points.push({ point, vertexId: canonicalVertexId });
      splitPointsByWall.set(event.leftWallId, points);
    }
    if (event.tRight > 0 && event.tRight < 1) {
      const points = splitPointsByWall.get(event.rightWallId) ?? [];
      points.push({ point, vertexId: canonicalVertexId });
      splitPointsByWall.set(event.rightWallId, points);
    }
  }

  const collapsedWallIds = Object.entries(next.walls)
    .filter(([, wall]) => {
      if (wall.start_vertex_id === wall.end_vertex_id) return true;
      const endpoints = wallEndpoints(next, wall);
      return (
        !endpoints ||
        distance(endpoints[0], endpoints[1]) <= toleranceMm
      );
    })
    .map(([wallId]) => wallId);
  if (collapsedWallIds.length > 0) {
    return failure('ZERO_LENGTH', collapsedWallIds);
  }

  const splitFailure = splitExistingWalls(next, splitPointsByWall, allocator, toleranceMm);
  if (splitFailure) return splitFailure;
  removeUnreferencedVertices(next);
  return {
    ok: true,
    document: next,
    createdWallIds: [],
    canonicalVertexIds: Object.fromEntries(canonicalIdByOriginal),
  };
}
