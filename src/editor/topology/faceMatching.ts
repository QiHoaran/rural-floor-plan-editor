import type {
  BuildingDocument,
  BuildingFace,
  BuildingValidationIssue,
  BuildingVertex,
} from '../domain/buildingTypes.ts';
import {
  geometryBoundarySignature,
  type DerivedFace,
} from './faceTraversal.ts';
import {
  polygonIntersectionOverUnion,
  polygonMetrics,
} from './polygonGeometry.ts';

export interface FaceMatchingResult {
  faces: Record<string, BuildingFace>;
  warnings: BuildingValidationIssue[];
}

export const DEFAULT_FACE_COLOR = '';

interface Point {
  x_mm: number;
  y_mm: number;
}

interface FaceGeometry {
  points: Point[];
  centroid: Point;
  area: number;
}

interface Candidate {
  oldId: string;
  derivedIndex: number;
  score: number;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function polygon(
  boundaryVertexIds: string[],
  vertices: Record<string, BuildingVertex>,
): Point[] | undefined {
  const points: Point[] = [];
  for (const vertexId of boundaryVertexIds) {
    const point = vertices[vertexId];
    if (
      !point ||
      !Number.isFinite(point.x_mm) ||
      !Number.isFinite(point.y_mm)
    ) {
      return undefined;
    }
    points.push(point);
  }
  return points.length >= 3 ? points : undefined;
}

function faceGeometry(
  face: Pick<BuildingFace, 'boundary_vertex_ids' | 'area_mm2'> | DerivedFace,
  vertices: Record<string, BuildingVertex>,
): FaceGeometry | undefined {
  const points = polygon(face.boundary_vertex_ids, vertices);
  if (!points || !Number.isFinite(face.area_mm2) || face.area_mm2 <= 0) {
    return undefined;
  }
  const metrics = polygonMetrics(points);
  if (!metrics) return undefined;
  return {
    points,
    centroid: metrics.centroid,
    area: metrics.area,
  };
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross =
    (point.x_mm - start.x_mm) * (end.y_mm - start.y_mm) -
    (point.y_mm - start.y_mm) * (end.x_mm - start.x_mm);
  if (Math.abs(cross) > 1e-7) return false;
  const dot =
    (point.x_mm - start.x_mm) * (point.x_mm - end.x_mm) +
    (point.y_mm - start.y_mm) * (point.y_mm - end.y_mm);
  return dot <= 1e-7;
}

function pointOnBoundary(point: Point, polygonPoints: Point[]): boolean {
  return polygonPoints.some((start, index) =>
    pointOnSegment(
      point,
      start,
      polygonPoints[(index + 1) % polygonPoints.length],
    ),
  );
}

function pointInPolygon(point: Point, polygonPoints: Point[]): boolean {
  if (pointOnBoundary(point, polygonPoints)) return true;
  let inside = false;
  for (
    let currentIndex = 0, previousIndex = polygonPoints.length - 1;
    currentIndex < polygonPoints.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygonPoints[currentIndex];
    const previous = polygonPoints[previousIndex];
    const crosses =
      current.y_mm > point.y_mm !== previous.y_mm > point.y_mm &&
      point.x_mm <
        ((previous.x_mm - current.x_mm) * (point.y_mm - current.y_mm)) /
          (previous.y_mm - current.y_mm) +
          current.x_mm;
    if (crosses) inside = !inside;
  }
  return inside;
}

function boundaryCoverage(source: Point[], target: Point[]): number {
  const count = source.filter((point) => pointOnBoundary(point, target)).length;
  return count / source.length;
}

function candidateScore(
  oldGeometry: FaceGeometry,
  derivedGeometry: FaceGeometry,
): number | undefined {
  const iou = polygonIntersectionOverUnion(
    oldGeometry.points,
    derivedGeometry.points,
  );
  if (iou === undefined || !Number.isFinite(iou) || iou < 0.5) {
    return undefined;
  }
  const areaRatio =
    Math.min(oldGeometry.area, derivedGeometry.area) /
    Math.max(oldGeometry.area, derivedGeometry.area);
  const centroidDistance = Math.hypot(
    oldGeometry.centroid.x_mm - derivedGeometry.centroid.x_mm,
    oldGeometry.centroid.y_mm - derivedGeometry.centroid.y_mm,
  );
  const scale = Math.max(
    Math.sqrt(oldGeometry.area),
    Math.sqrt(derivedGeometry.area),
    1,
  );
  const containment =
    (Number(pointInPolygon(oldGeometry.centroid, derivedGeometry.points)) +
      Number(pointInPolygon(derivedGeometry.centroid, oldGeometry.points))) /
    2;
  const boundary =
    (boundaryCoverage(oldGeometry.points, derivedGeometry.points) +
      boundaryCoverage(derivedGeometry.points, oldGeometry.points)) /
    2;

  if (
    !Number.isFinite(areaRatio) ||
    !Number.isFinite(centroidDistance) ||
    !Number.isFinite(scale) ||
    !Number.isFinite(containment) ||
    !Number.isFinite(boundary) ||
    areaRatio < 0.45 ||
    centroidDistance > scale * 1.5 ||
    (containment === 0 && boundary === 0 && centroidDistance > scale * 0.35)
  ) {
    return undefined;
  }
  const distanceSimilarity = Math.max(0, 1 - centroidDistance / (scale * 1.5));
  const score =
    iou * 0.65 +
    areaRatio * 0.15 +
    distanceSimilarity * 0.1 +
    containment * 0.05 +
    boundary * 0.05;
  return Number.isFinite(score) ? score : undefined;
}

function uniquelyBest<T>(
  entries: T[],
  score: (entry: T) => number,
): T | undefined {
  if (entries.length === 0) return undefined;
  const sorted = [...entries].sort((left, right) => score(right) - score(left));
  if (
    sorted.length > 1 &&
    Math.abs(score(sorted[0]) - score(sorted[1])) <= 1e-9
  ) {
    return undefined;
  }
  return sorted[0];
}

function hasAnnotation(face: BuildingFace): boolean {
  return Boolean(
    face.function_code ||
      face.display_name ||
      face.color !== DEFAULT_FACE_COLOR ||
      face.local_name ||
      face.notes,
  );
}

function defaultFace(derived: DerivedFace): BuildingFace {
  return {
    ...derived,
    boundary_vertex_ids: [...derived.boundary_vertex_ids],
    function_code: null,
    display_name: '',
    color: DEFAULT_FACE_COLOR,
    local_name: '',
  };
}

function maximumNumericFaceId(ids: Iterable<string>): bigint {
  let maximum = 0n;
  for (const id of ids) {
    const match = id.match(/^face_(\d+)$/);
    if (!match) continue;
    const value = BigInt(match[1]);
    if (value > maximum) maximum = value;
  }
  return maximum;
}

function makeFaceIdAllocator(reservedIds: Iterable<string>): () => string {
  const reserved = new Set(reservedIds);
  let counter = maximumNumericFaceId(reserved);
  return () => {
    let id: string;
    do {
      counter += 1n;
      id = `face_${String(counter).padStart(4, '0')}`;
    } while (reserved.has(id));
    reserved.add(id);
    return id;
  };
}

function reviewWarning(oldId: string, ambiguous: boolean): BuildingValidationIssue {
  return {
    id: `face_annotation_review:${oldId}`,
    level: 'warning',
    code: 'FACE_ANNOTATION_REVIEW',
    message: ambiguous
      ? `Face ${oldId} has multiple equally plausible replacements; review its annotation.`
      : `Annotated face ${oldId} no longer has a unique replacement; review its annotation.`,
    entity: { type: 'face', id: oldId },
  };
}

/**
 * Matches derived geometry to old faces one-to-one. Exact coordinate signatures
 * win first; fuzzy matches must be the unique best choice in both directions.
 */
export function matchFaces(
  oldFaces: Record<string, BuildingFace>,
  derivedFaces: DerivedFace[],
  vertices: Record<string, BuildingVertex>,
  oldVertices: Record<string, BuildingVertex> = vertices,
  reservedIds: Iterable<string> = [],
): FaceMatchingResult {
  const sortedOldIds = Object.keys(oldFaces).sort(compareStrings);
  const derivedOrder = derivedFaces
    .map((face, index) => ({
      face,
      index,
      signature: geometryBoundarySignature(face.boundary_vertex_ids, vertices),
    }))
    .sort(
      (left, right) =>
        compareStrings(left.signature, right.signature) ||
        compareStrings(
          left.face.boundary_vertex_ids.join('|'),
          right.face.boundary_vertex_ids.join('|'),
        ),
    );
  const oldSignatures = new Map(
    sortedOldIds.map((id) => [
      id,
      geometryBoundarySignature(
        oldFaces[id].boundary_vertex_ids,
        oldVertices,
      ),
    ]),
  );
  const matchedOld = new Set<string>();
  const matchedDerived = new Set<number>();
  const matches = new Map<number, string>();
  const oldGeometries = new Map(
    sortedOldIds.map((id) => [
      id,
      faceGeometry(oldFaces[id], oldVertices),
    ]),
  );
  const derivedGeometries = new Map(
    derivedOrder.map((entry) => [
      entry.index,
      faceGeometry(entry.face, vertices),
    ]),
  );

  const signatures = new Set(
    [...oldSignatures.values(), ...derivedOrder.map((entry) => entry.signature)]
      .filter(Boolean),
  );
  for (const signature of [...signatures].sort(compareStrings)) {
    const oldIds = sortedOldIds.filter(
      (id) => oldSignatures.get(id) === signature,
    );
    const derived = derivedOrder.filter(
      (entry) => entry.signature === signature,
    );
    if (
      oldIds.length === 1 &&
      derived.length === 1 &&
      oldGeometries.get(oldIds[0]) &&
      derivedGeometries.get(derived[0].index)
    ) {
      matchedOld.add(oldIds[0]);
      matchedDerived.add(derived[0].index);
      matches.set(derived[0].index, oldIds[0]);
    }
  }

  const candidates: Candidate[] = [];
  for (const oldId of sortedOldIds) {
    if (matchedOld.has(oldId)) continue;
    const oldGeometry = oldGeometries.get(oldId);
    if (!oldGeometry) continue;
    for (const entry of derivedOrder) {
      if (matchedDerived.has(entry.index)) continue;
      const derivedGeometry = derivedGeometries.get(entry.index);
      if (!derivedGeometry) continue;
      const score = candidateScore(oldGeometry, derivedGeometry);
      if (score !== undefined) {
        candidates.push({ oldId, derivedIndex: entry.index, score });
      }
    }
  }

  let madeMatch = true;
  while (madeMatch) {
    madeMatch = false;
    for (const oldId of sortedOldIds) {
      if (matchedOld.has(oldId)) continue;
      const availableForOld = candidates.filter(
        (candidate) =>
          candidate.oldId === oldId &&
          !matchedDerived.has(candidate.derivedIndex),
      );
      const oldChoice = uniquelyBest(
        availableForOld,
        (candidate) => candidate.score,
      );
      if (!oldChoice) continue;
      const availableForDerived = candidates.filter(
        (candidate) =>
          candidate.derivedIndex === oldChoice.derivedIndex &&
          !matchedOld.has(candidate.oldId),
      );
      const derivedChoice = uniquelyBest(
        availableForDerived,
        (candidate) => candidate.score,
      );
      if (!derivedChoice || derivedChoice.oldId !== oldId) continue;
      matchedOld.add(oldId);
      matchedDerived.add(oldChoice.derivedIndex);
      matches.set(oldChoice.derivedIndex, oldId);
      madeMatch = true;
    }
  }

  const allocateFaceId = makeFaceIdAllocator([
    ...sortedOldIds,
    ...reservedIds,
  ]);
  const resultEntries: Array<[string, BuildingFace]> = [];
  for (const entry of derivedOrder) {
    const oldId = matches.get(entry.index);
    if (oldId) {
      resultEntries.push([
        oldId,
        {
          ...oldFaces[oldId],
          boundary_vertex_ids: [...entry.face.boundary_vertex_ids],
          area_mm2: entry.face.area_mm2,
        },
      ]);
    } else {
      resultEntries.push([allocateFaceId(), defaultFace(entry.face)]);
    }
  }
  resultEntries.sort(([left], [right]) => compareStrings(left, right));

  const warnings = sortedOldIds
    .filter((oldId) => !matchedOld.has(oldId) && hasAnnotation(oldFaces[oldId]))
    .map((oldId) => {
      const scores = candidates
        .filter((candidate) => candidate.oldId === oldId)
        .map((candidate) => candidate.score)
        .sort((left, right) => right - left);
      const ambiguous =
        scores.length > 1 && Math.abs(scores[0] - scores[1]) <= 1e-9;
      return reviewWarning(oldId, ambiguous);
    });

  return {
    faces: Object.fromEntries(resultEntries),
    warnings,
  };
}

/**
 * Applies a derived face set without mutating either document. Pass the
 * pre-edit document as `previousDocument` when vertex coordinates changed.
 */
export function applyDerivedFaces(
  document: BuildingDocument,
  derivedFaces: DerivedFace[],
  previousDocument: BuildingDocument = document,
): BuildingDocument {
  const matched = matchFaces(
    previousDocument.faces,
    derivedFaces,
    document.vertices,
    previousDocument.vertices,
    Object.keys(document.outside_regions),
  );
  const faceIds = Object.keys(matched.faces).sort(compareStrings);
  return {
    ...document,
    faces: matched.faces,
    floors: document.floors.map((floor) => ({
      ...floor,
      face_ids: [...faceIds],
    })) as BuildingDocument['floors'],
    validation: {
      issues: [
        ...document.validation.issues.filter(
          (issue) => issue.code !== 'FACE_ANNOTATION_REVIEW',
        ),
        ...matched.warnings,
      ],
    },
  };
}
