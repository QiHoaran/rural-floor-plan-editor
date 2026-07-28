import type {
  BuildingDocument,
  BuildingVertex,
} from '@/editor/domain/buildingTypes.ts';
import { intersectSegments } from '@/editor/topology/segmentIntersection.ts';

export type SnapResult =
  | { kind: 'none' }
  | { kind: 'vertex'; point: BuildingVertex; vertexId: string }
  | {
      kind: 'intersection';
      point: BuildingVertex;
      wallIds: [string, string];
    }
  | {
      kind: 'wall_projection';
      point: BuildingVertex;
      wallId: string;
    }
  | { kind: 'grid'; point: BuildingVertex };

export type SnapMode = 'grid' | 'geometry' | 'none';

interface IndexedVertex {
  id: string;
  point: BuildingVertex;
}

interface IndexedWall {
  wallId: string;
  start: BuildingVertex;
  end: BuildingVertex;
}

interface IndexedIntersection {
  point: BuildingVertex;
  wallIds: [string, string];
}

export interface SnapIndex {
  snapEnabled: boolean;
  gridSizeMm: number;
  vertices: readonly IndexedVertex[];
  walls: readonly IndexedWall[];
  intersections: readonly IndexedIntersection[];
}

export function createSnapIndex(document: BuildingDocument): SnapIndex {
  const vertexByCoordinate = new Map<string, IndexedVertex>();
  for (const [id, point] of Object.entries(document.vertices).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const key = pointKey(point);
    if (!vertexByCoordinate.has(key)) {
      vertexByCoordinate.set(key, { id, point });
    }
  }

  const walls: IndexedWall[] = [];
  for (const [wallId, wall] of Object.entries(document.walls).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const start = document.vertices[wall.start_vertex_id];
    const end = document.vertices[wall.end_vertex_id];
    if (start && end) walls.push({ wallId, start, end });
  }

  const intersectionByCoordinate = new Map<string, IndexedIntersection>();
  for (let left = 0; left < walls.length; left += 1) {
    for (let right = left + 1; right < walls.length; right += 1) {
      const intersection = intersectSegments(
        walls[left].start,
        walls[left].end,
        walls[right].start,
        walls[right].end,
        0,
      );
      if (intersection.kind !== 'point') continue;
      const key = pointKey(intersection.point);
      if (!intersectionByCoordinate.has(key)) {
        intersectionByCoordinate.set(key, {
          point: intersection.point,
          wallIds: [walls[left].wallId, walls[right].wallId],
        });
      }
    }
  }

  return {
    snapEnabled: document.building_defaults.snap_enabled,
    gridSizeMm: document.building_defaults.grid_size_mm || 100,
    vertices: [...vertexByCoordinate.values()],
    walls,
    intersections: [...intersectionByCoordinate.values()],
  };
}

export function findSnap(
  index: SnapIndex,
  point: BuildingVertex,
  pixelsPerMm: number,
  mode: SnapMode,
  radiusPx = 12,
  excludeVertexIds?: Set<string>,
): SnapResult {
  if (!index.snapEnabled || mode === 'none') return { kind: 'none' };
  const radiusMm = radiusPx / pixelsPerMm;

  if (mode === 'geometry') {
    const candidates = excludeVertexIds
      ? index.vertices.filter((v) => !excludeVertexIds.has(v.id))
      : index.vertices;
    const vertex = nearestVertex(candidates, point, radiusMm);
    if (vertex) {
      return {
        kind: 'vertex',
        point: vertex.point,
        vertexId: vertex.id,
      };
    }
    const intersection = nearestPoint(index.intersections, point, radiusMm);
    if (intersection) {
      return {
        kind: 'intersection',
        point: intersection.item.point,
        wallIds: intersection.item.wallIds,
      };
    }
    const projection = nearestWallProjection(index.walls, point, radiusMm);
    if (projection) {
      return {
        kind: 'wall_projection',
        point: projection.point,
        wallId: projection.wallId,
      };
    }
  }

  const gridPoint = {
    x_mm: Math.round(point.x_mm / index.gridSizeMm) * index.gridSizeMm,
    y_mm: Math.round(point.y_mm / index.gridSizeMm) * index.gridSizeMm,
  };
  return distance(point, gridPoint) <= radiusMm
    ? { kind: 'grid', point: gridPoint }
    : { kind: 'none' };
}

export function snapTypedEndpoint(
  document: BuildingDocument,
  point: BuildingVertex,
): { point: BuildingVertex; vertexId?: string } {
  const vertices = Object.entries(document.vertices).map(([id, vertex]) => ({
    id,
    point: vertex,
  }));
  const nearest = nearestVertex(vertices, point, 1);
  return nearest
    ? { point: nearest.point, vertexId: nearest.id }
    : { point };
}

function nearestVertex(
  vertices: readonly IndexedVertex[],
  point: BuildingVertex,
  radiusMm: number,
): (IndexedVertex & { distance: number }) | undefined {
  let nearest: (IndexedVertex & { distance: number }) | undefined;
  for (const vertex of vertices) {
    const candidateDistance = distance(point, vertex.point);
    if (candidateDistance > radiusMm) continue;
    if (
      !nearest ||
      candidateDistance < nearest.distance ||
      (candidateDistance === nearest.distance && vertex.id < nearest.id)
    ) {
      nearest = { ...vertex, distance: candidateDistance };
    }
  }
  return nearest;
}

function nearestPoint<T extends { point: BuildingVertex }>(
  items: readonly T[],
  point: BuildingVertex,
  radiusMm: number,
): { item: T; distance: number } | undefined {
  let nearest: { item: T; distance: number } | undefined;
  for (const item of items) {
    const candidateDistance = distance(point, item.point);
    if (
      candidateDistance <= radiusMm &&
      (!nearest || candidateDistance < nearest.distance)
    ) {
      nearest = { item, distance: candidateDistance };
    }
  }
  return nearest;
}

function nearestWallProjection(
  walls: readonly IndexedWall[],
  point: BuildingVertex,
  radiusMm: number,
): { point: BuildingVertex; wallId: string; distance: number } | undefined {
  let nearest:
    | { point: BuildingVertex; wallId: string; distance: number }
    | undefined;
  for (const wall of walls) {
    const projection = projectToSegment(point, wall.start, wall.end);
    const candidateDistance = distance(point, projection);
    if (
      candidateDistance <= radiusMm &&
      (!nearest || candidateDistance < nearest.distance)
    ) {
      nearest = {
        point: projection,
        wallId: wall.wallId,
        distance: candidateDistance,
      };
    }
  }
  return nearest;
}

function projectToSegment(
  point: BuildingVertex,
  start: BuildingVertex,
  end: BuildingVertex,
): BuildingVertex {
  const dx = end.x_mm - start.x_mm;
  const dy = end.y_mm - start.y_mm;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return start;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x_mm - start.x_mm) * dx +
        (point.y_mm - start.y_mm) * dy) /
        lengthSquared,
    ),
  );
  return {
    x_mm: Math.round(start.x_mm + t * dx),
    y_mm: Math.round(start.y_mm + t * dy),
  };
}

function pointKey(point: BuildingVertex): string {
  return `${point.x_mm},${point.y_mm}`;
}

function distance(left: BuildingVertex, right: BuildingVertex): number {
  return Math.hypot(
    left.x_mm - right.x_mm,
    left.y_mm - right.y_mm,
  );
}
