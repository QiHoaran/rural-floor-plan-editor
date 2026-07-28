import type {
  BuildingDocument,
  BuildingRelation,
  BuildingValidationIssue,
  BuildingVertex,
  RelationChannels,
  WallElementType,
} from '../domain/buildingTypes.ts';
import {
  areCollinear,
  polygonSignedDoubleArea,
} from '../topology/polygonGeometry.ts';

export interface DeriveRelationsResult {
  relations: BuildingRelation[];
  issues: BuildingValidationIssue[];
}

interface AdjacentRegion {
  id: string;
  kind: 'face' | 'outside';
  side: -1 | 1;
}

type BoundaryMatch =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'match'; side: -1 | 1 };

const CHANNELS: Record<WallElementType, RelationChannels> = {
  exterior_door: { people: true, air: true, light: true },
  exterior_window: { people: false, air: true, light: true },
  interior_door: { people: true, air: true, light: false },
  passage: { people: true, air: true, light: false },
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finitePoint(point: BuildingVertex | undefined): point is BuildingVertex {
  return (
    point !== undefined &&
    Number.isFinite(point.x_mm) &&
    Number.isFinite(point.y_mm)
  );
}

function coordinate(point: BuildingVertex, axis: 'x_mm' | 'y_mm'): number {
  return point[axis];
}

function segmentOverlapsWall(
  segmentStart: BuildingVertex,
  segmentEnd: BuildingVertex,
  wallStart: BuildingVertex,
  wallEnd: BuildingVertex,
): boolean {
  if (
    !areCollinear(wallStart, wallEnd, segmentStart) ||
    !areCollinear(wallStart, wallEnd, segmentEnd)
  ) {
    return false;
  }
  const axis =
    Math.abs(wallEnd.x_mm - wallStart.x_mm) >=
    Math.abs(wallEnd.y_mm - wallStart.y_mm)
      ? 'x_mm'
      : 'y_mm';
  return (
    Math.min(
      Math.max(coordinate(segmentStart, axis), coordinate(segmentEnd, axis)),
      Math.max(coordinate(wallStart, axis), coordinate(wallEnd, axis)),
    ) >
    Math.max(
      Math.min(coordinate(segmentStart, axis), coordinate(segmentEnd, axis)),
      Math.min(coordinate(wallStart, axis), coordinate(wallEnd, axis)),
    )
  );
}

function malformedBoundaryTouchesWall(
  boundary: string[],
  points: Array<BuildingVertex | undefined>,
  wallStartId: string,
  wallEndId: string,
  wallStart: BuildingVertex,
  wallEnd: BuildingVertex,
): boolean {
  if (boundary.includes(wallStartId) && boundary.includes(wallEndId)) {
    return true;
  }
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (
      finitePoint(start) &&
      finitePoint(end) &&
      segmentOverlapsWall(start, end, wallStart, wallEnd)
    ) {
      return true;
    }
  }
  return false;
}

function boundaryMatch(
  boundary: string[],
  vertices: BuildingDocument['vertices'],
  wallStartId: string,
  wallEndId: string,
  wallStart: BuildingVertex,
  wallEnd: BuildingVertex,
): BoundaryMatch {
  const points = boundary.map((id) => vertices[id]);
  if (boundary.length < 3 || !points.every(finitePoint)) {
    return {
      status: malformedBoundaryTouchesWall(
        boundary,
        points,
        wallStartId,
        wallEndId,
        wallStart,
        wallEnd,
      )
        ? 'invalid'
        : 'none',
    };
  }

  const area = polygonSignedDoubleArea(points);
  if (!Number.isFinite(area) || area === 0) {
    return {
      status: malformedBoundaryTouchesWall(
        boundary,
        points,
        wallStartId,
        wallEndId,
        wallStart,
        wallEnd,
      )
        ? 'invalid'
        : 'none',
    };
  }

  const axis =
    Math.abs(wallEnd.x_mm - wallStart.x_mm) >=
    Math.abs(wallEnd.y_mm - wallStart.y_mm)
      ? 'x_mm'
      : 'y_mm';
  const startCoordinate = coordinate(wallStart, axis);
  const endCoordinate = coordinate(wallEnd, axis);
  const wallMinimum = Math.min(startCoordinate, endCoordinate);
  const wallMaximum = Math.max(startCoordinate, endCoordinate);
  if (wallMinimum === wallMaximum) return { status: 'invalid' };

  const intervals: Array<{ minimum: number; maximum: number; direction: -1 | 1 }> =
    [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (
      !areCollinear(wallStart, wallEnd, start) ||
      !areCollinear(wallStart, wallEnd, end)
    ) {
      continue;
    }
    const segmentStart = coordinate(start, axis);
    const segmentEnd = coordinate(end, axis);
    const minimum = Math.max(
      wallMinimum,
      Math.min(segmentStart, segmentEnd),
    );
    const maximum = Math.min(
      wallMaximum,
      Math.max(segmentStart, segmentEnd),
    );
    if (maximum <= minimum) continue;
    intervals.push({
      minimum,
      maximum,
      direction:
        Math.sign((segmentEnd - segmentStart) * (endCoordinate - startCoordinate)) <
        0
          ? -1
          : 1,
    });
  }
  if (intervals.length === 0) return { status: 'none' };
  intervals.sort(
    (left, right) =>
      left.minimum - right.minimum ||
      left.maximum - right.maximum ||
      left.direction - right.direction,
  );
  const directions = new Set(intervals.map((interval) => interval.direction));
  if (directions.size !== 1) return { status: 'invalid' };

  let coveredUntil = wallMinimum;
  for (const interval of intervals) {
    if (interval.minimum > coveredUntil) return { status: 'none' };
    coveredUntil = Math.max(coveredUntil, interval.maximum);
  }
  if (coveredUntil < wallMaximum) return { status: 'none' };

  const direction = intervals[0].direction;
  const areaDirection = area > 0 ? 1 : -1;
  return {
    status: 'match',
    side: (direction * areaDirection) as -1 | 1,
  };
}

function issue(
  code:
    | 'ELEMENT_HOST_WALL_MISSING'
    | 'ELEMENT_REGION_AMBIGUOUS'
    | 'ELEMENT_SIDE_MISMATCH',
  elementId: string,
): BuildingValidationIssue {
  const messages = {
    ELEMENT_HOST_WALL_MISSING: `Wall element ${elementId} references a missing host wall.`,
    ELEMENT_REGION_AMBIGUOUS: `The regions beside wall element ${elementId} cannot be determined uniquely.`,
    ELEMENT_SIDE_MISMATCH: `Wall element ${elementId} does not match the indoor/outside regions beside its host wall.`,
  };
  return {
    id: `${code.toLowerCase()}:${elementId}`,
    level: 'error',
    code,
    message: messages[code],
    entity: { type: 'wall_element', id: elementId },
  };
}

function adjacentRegions(
  document: BuildingDocument,
  wallId: string,
): { regions?: AdjacentRegion[]; ambiguous: boolean } {
  const wall = document.walls[wallId];
  if (!wall) return { ambiguous: true };
  const wallStart = document.vertices[wall.start_vertex_id];
  const wallEnd = document.vertices[wall.end_vertex_id];
  if (
    !finitePoint(wallStart) ||
    !finitePoint(wallEnd) ||
    (wallStart.x_mm === wallEnd.x_mm && wallStart.y_mm === wallEnd.y_mm)
  ) {
    return { ambiguous: true };
  }

  const regions: AdjacentRegion[] = [];
  let invalidBoundary = false;
  for (const id of Object.keys(document.faces).sort(compareStrings)) {
    const match = boundaryMatch(
      document.faces[id].boundary_vertex_ids,
      document.vertices,
      wall.start_vertex_id,
      wall.end_vertex_id,
      wallStart,
      wallEnd,
    );
    if (match.status === 'invalid') invalidBoundary = true;
    if (match.status === 'match') regions.push({ id, kind: 'face', side: match.side });
  }
  for (const id of Object.keys(document.outside_regions).sort(compareStrings)) {
    const match = boundaryMatch(
      document.outside_regions[id].boundary_vertex_ids,
      document.vertices,
      wall.start_vertex_id,
      wall.end_vertex_id,
      wallStart,
      wallEnd,
    );
    if (match.status === 'invalid') invalidBoundary = true;
    if (match.status === 'match') {
      regions.push({ id, kind: 'outside', side: match.side });
    }
  }
  if (invalidBoundary) return { ambiguous: true };

  const negative = regions.filter((region) => region.side === -1);
  const positive = regions.filter((region) => region.side === 1);
  if (negative.length > 1 || positive.length > 1) return { ambiguous: true };
  if (regions.length === 0) return { ambiguous: true };
  return { regions, ambiguous: false };
}

function deriveOne(
  document: BuildingDocument,
  elementId: string,
  adjacencyByWall: Map<
    string,
    { regions?: AdjacentRegion[]; ambiguous: boolean }
  >,
): { relation?: BuildingRelation; issue?: BuildingValidationIssue } {
  const element = document.wall_elements[elementId];
  if (!document.walls[element.host_wall_id]) {
    return {
      issue: issue('ELEMENT_HOST_WALL_MISSING', elementId),
    };
  }
  let adjacency = adjacencyByWall.get(element.host_wall_id);
  if (!adjacency) {
    adjacency = adjacentRegions(document, element.host_wall_id);
    adjacencyByWall.set(element.host_wall_id, adjacency);
  }
  if (adjacency.ambiguous || !adjacency.regions) {
    return { issue: issue('ELEMENT_REGION_AMBIGUOUS', elementId) };
  }

  const indoorIds = adjacency.regions
    .filter((region) => region.kind === 'face')
    .map((region) => region.id)
    .sort(compareStrings);
  const boundedOutsideCount = adjacency.regions.filter(
    (region) => region.kind === 'outside',
  ).length;
  const exterior =
    indoorIds.length === 1 &&
    boundedOutsideCount <= 1 &&
    adjacency.regions.length <= 2;
  const interior =
    indoorIds.length === 2 &&
    indoorIds[0] !== indoorIds[1] &&
    boundedOutsideCount === 0 &&
    adjacency.regions.length === 2;
  const expectsExterior =
    element.element_type === 'exterior_door' ||
    element.element_type === 'exterior_window';

  if ((expectsExterior && !exterior) || (!expectsExterior && !interior)) {
    const topologyIsRecognizable =
      exterior ||
      interior;
    return {
      issue: issue(
        topologyIsRecognizable
          ? 'ELEMENT_SIDE_MISMATCH'
          : 'ELEMENT_REGION_AMBIGUOUS',
        elementId,
      ),
    };
  }

  if (expectsExterior) {
    return {
      relation: {
        relation_type: 'opening',
        wall_element_id: elementId,
        from_face_id: indoorIds[0],
        to: { kind: 'outside' },
        channels: { ...CHANNELS[element.element_type] },
      },
    };
  }
  return {
    relation: {
      relation_type: 'connection',
      wall_element_id: elementId,
      from_face_id: indoorIds[0],
      to: { kind: 'face', face_id: indoorIds[1] },
      channels: { ...CHANNELS[element.element_type] },
    },
  };
}

/**
 * Derives the connectivity cache exclusively from wall elements and topology.
 * Element IDs are sorted so object insertion order cannot affect the result.
 */
export function deriveRelations(document: BuildingDocument): DeriveRelationsResult {
  const relations: BuildingRelation[] = [];
  const issues: BuildingValidationIssue[] = [];
  const adjacencyByWall = new Map<
    string,
    { regions?: AdjacentRegion[]; ambiguous: boolean }
  >();
  for (const elementId of Object.keys(document.wall_elements).sort(compareStrings)) {
    const derived = deriveOne(document, elementId, adjacencyByWall);
    if (derived.relation) relations.push(derived.relation);
    if (derived.issue) issues.push(derived.issue);
  }
  return { relations, issues };
}
