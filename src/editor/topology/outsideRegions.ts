import type {
  BuildingDocument,
  BuildingValidationIssue,
  BuildingVertex,
  OutsideRegion,
} from '../domain/buildingTypes.ts';
import {
  geometryBoundarySignature,
  type DerivedFace,
} from './faceTraversal.ts';
import { matchFaces } from './faceMatching.ts';
import { polygonIntersectionOverUnion } from './polygonGeometry.ts';

export type MarkFaceAsOutsideResult =
  | {
      ok: true;
      document: BuildingDocument;
      outsideRegionId: string;
    }
  | {
      ok: false;
      document: BuildingDocument;
      error: 'FACE_NOT_FOUND';
      faceId: string;
    };

interface MatchCandidate {
  regionId: string;
  candidateIndex: number;
  score: number;
}

const MINIMUM_OUTSIDE_IOU = 0.6;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nextOutsideRegionId(ids: Iterable<string>): string {
  const reserved = new Set(ids);
  let maximum = 0n;
  for (const id of reserved) {
    const match = /^outside_region_(\d+)$/.exec(id);
    if (!match) continue;
    const value = BigInt(match[1]);
    if (value > maximum) maximum = value;
  }
  let id: string;
  do {
    maximum += 1n;
    id = `outside_region_${String(maximum).padStart(4, '0')}`;
  } while (reserved.has(id));
  return id;
}

export function markFaceAsOutside(
  document: BuildingDocument,
  faceId: string,
): MarkFaceAsOutsideResult {
  const face = document.faces[faceId];
  if (!face) {
    return {
      ok: false,
      document,
      error: 'FACE_NOT_FOUND',
      faceId,
    };
  }

  const outsideRegionId = nextOutsideRegionId([
    ...Object.keys(document.outside_regions),
    ...Object.keys(document.faces),
  ]);
  const faces = { ...document.faces };
  delete faces[faceId];
  return {
    ok: true,
    outsideRegionId,
    document: {
      ...document,
      faces,
      outside_regions: {
        ...document.outside_regions,
        [outsideRegionId]: {
          boundary_vertex_ids: [...face.boundary_vertex_ids],
          region_type: 'courtyard',
        },
      },
      floors: document.floors.map((floor) => ({
        ...floor,
        face_ids: floor.face_ids.filter((id) => id !== faceId),
      })) as BuildingDocument['floors'],
    },
  };
}

function points(
  boundary: string[],
  vertices: Record<string, BuildingVertex>,
) {
  const result = boundary.map((id) => vertices[id]);
  return result.length >= 3 && result.every(Boolean) ? result : undefined;
}

interface PolygonBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function polygonBounds(polygonPoints: BuildingVertex[]): PolygonBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygonPoints) {
    minX = Math.min(minX, point.x_mm);
    minY = Math.min(minY, point.y_mm);
    maxX = Math.max(maxX, point.x_mm);
    maxY = Math.max(maxY, point.y_mm);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(left: PolygonBounds, right: PolygonBounds): boolean {
  return !(
    left.maxX < right.minX ||
    right.maxX < left.minX ||
    left.maxY < right.minY ||
    right.maxY < left.minY
  );
}

function uniqueBest(
  entries: MatchCandidate[],
  claimedRegions: Set<string>,
  claimedCandidates: Set<number>,
): MatchCandidate | undefined {
  const available = entries
    .filter(
      (entry) =>
        !claimedRegions.has(entry.regionId) &&
        !claimedCandidates.has(entry.candidateIndex),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareStrings(left.regionId, right.regionId) ||
        left.candidateIndex - right.candidateIndex,
    );
  if (
    available.length === 0 ||
    (available.length > 1 &&
      Math.abs(available[0].score - available[1].score) <= 1e-9)
  ) {
    return undefined;
  }
  return available[0];
}

function reviewWarning(regionId: string): BuildingValidationIssue {
  return {
    id: `outside_region_review:${regionId}`,
    level: 'warning',
    code: 'OUTSIDE_REGION_REVIEW',
    message: `Outside region ${regionId} no longer has a unique replacement; review its boundary.`,
    entity: { type: 'outside_region', id: regionId },
  };
}

/**
 * Reconciles persistent outside-region markers before matching the remaining
 * derived polygons as indoor faces. Exact geometry wins; fuzzy IoU matches
 * must be unique in both directions.
 */
export function applyOutsideRegions(
  document: BuildingDocument,
  derivedCandidates: DerivedFace[],
): BuildingDocument {
  const regionIds = Object.keys(document.outside_regions).sort(compareStrings);
  const candidateOrder = derivedCandidates
    .map((candidate, index) => ({
      candidate,
      index,
      signature: geometryBoundarySignature(
        candidate.boundary_vertex_ids,
        document.vertices,
      ),
    }))
    .sort(
      (left, right) =>
        compareStrings(left.signature, right.signature) ||
        compareStrings(
          left.candidate.boundary_vertex_ids.join('|'),
          right.candidate.boundary_vertex_ids.join('|'),
        ) ||
        left.index - right.index,
    );
  const regionSignatures = new Map(
    regionIds.map((regionId) => [
      regionId,
      geometryBoundarySignature(
        document.outside_regions[regionId].boundary_vertex_ids,
        document.vertices,
      ),
    ]),
  );
  const claimedRegions = new Set<string>();
  const claimedCandidates = new Set<number>();
  const matches = new Map<string, number>();

  const signatures = [
    ...new Set(
      [...regionSignatures.values(), ...candidateOrder.map((entry) => entry.signature)]
        .filter(Boolean),
    ),
  ].sort(compareStrings);
  for (const signature of signatures) {
    const regions = regionIds.filter(
      (regionId) => regionSignatures.get(regionId) === signature,
    );
    const candidates = candidateOrder.filter(
      (entry) => entry.signature === signature,
    );
    if (regions.length === 1 && candidates.length === 1) {
      claimedRegions.add(regions[0]);
      claimedCandidates.add(candidates[0].index);
      matches.set(regions[0], candidates[0].index);
    }
  }

  const regionGeometry = new Map(
    regionIds.map((regionId) => {
      const polygonPoints = points(
        document.outside_regions[regionId].boundary_vertex_ids,
        document.vertices,
      );
      return [
        regionId,
        polygonPoints
          ? { points: polygonPoints, bounds: polygonBounds(polygonPoints) }
          : undefined,
      ] as const;
    }),
  );
  const candidateGeometry = new Map(
    candidateOrder.map((entry) => {
      const polygonPoints = points(
        entry.candidate.boundary_vertex_ids,
        document.vertices,
      );
      return [
        entry.index,
        polygonPoints
          ? { points: polygonPoints, bounds: polygonBounds(polygonPoints) }
          : undefined,
      ] as const;
    }),
  );
  const iouByPair = new Map<string, number | undefined>();
  const fuzzy: MatchCandidate[] = [];
  for (const regionId of regionIds) {
    if (claimedRegions.has(regionId)) continue;
    const region = regionGeometry.get(regionId);
    if (!region) continue;
    for (const entry of candidateOrder) {
      if (claimedCandidates.has(entry.index)) continue;
      const candidate = candidateGeometry.get(entry.index);
      if (!candidate || !boundsOverlap(region.bounds, candidate.bounds)) {
        continue;
      }
      const pairKey = `${regionId}\u0000${entry.index}`;
      let score = iouByPair.get(pairKey);
      if (!iouByPair.has(pairKey)) {
        score = polygonIntersectionOverUnion(
          region.points,
          candidate.points,
        );
        iouByPair.set(pairKey, score);
      }
      if (score !== undefined && score >= MINIMUM_OUTSIDE_IOU) {
        fuzzy.push({ regionId, candidateIndex: entry.index, score });
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const regionId of regionIds) {
      if (claimedRegions.has(regionId)) continue;
      const regionChoice = uniqueBest(
        fuzzy.filter((entry) => entry.regionId === regionId),
        claimedRegions,
        claimedCandidates,
      );
      if (!regionChoice) continue;
      const candidateChoice = uniqueBest(
        fuzzy.filter(
          (entry) => entry.candidateIndex === regionChoice.candidateIndex,
        ),
        claimedRegions,
        claimedCandidates,
      );
      if (!candidateChoice || candidateChoice.regionId !== regionId) continue;
      claimedRegions.add(regionId);
      claimedCandidates.add(regionChoice.candidateIndex);
      matches.set(regionId, regionChoice.candidateIndex);
      changed = true;
    }
  }

  const outsideRegions: Record<string, OutsideRegion> = {};
  for (const regionId of regionIds) {
    const candidateIndex = matches.get(regionId);
    outsideRegions[regionId] =
      candidateIndex === undefined
        ? {
            ...document.outside_regions[regionId],
            boundary_vertex_ids: [
              ...document.outside_regions[regionId].boundary_vertex_ids,
            ],
          }
        : {
            ...document.outside_regions[regionId],
            boundary_vertex_ids: [
              ...derivedCandidates[candidateIndex].boundary_vertex_ids,
            ],
          };
  }

  const indoorCandidates = derivedCandidates.filter(
    (_, index) => !claimedCandidates.has(index),
  );
  const matchedFaces = matchFaces(
    document.faces,
    indoorCandidates,
    document.vertices,
    document.vertices,
    Object.keys(document.outside_regions),
  );
  const faceIds = Object.keys(matchedFaces.faces).sort(compareStrings);
  const warnings = regionIds
    .filter((regionId) => !claimedRegions.has(regionId))
    .map(reviewWarning);
  const retainedIssues = document.validation.issues.filter(
    (issue) =>
      issue.code !== 'OUTSIDE_REGION_REVIEW' &&
      issue.code !== 'FACE_ANNOTATION_REVIEW',
  );
  return {
    ...document,
    faces: matchedFaces.faces,
    outside_regions: outsideRegions,
    floors: document.floors.map((floor) => ({
      ...floor,
      face_ids: [...faceIds],
    })) as BuildingDocument['floors'],
    validation: {
      issues: [
        ...retainedIssues,
        ...matchedFaces.warnings,
        ...warnings,
      ],
    },
  };
}
