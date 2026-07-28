import type {
  BuildingDocument,
  BuildingValidationIssue,
} from '../domain/buildingTypes.ts';
import {
  buildConnectivityGraph,
  reachableFromOutside,
} from './connectivityGraph.ts';
import {
  deriveRelations,
  type DeriveRelationsResult,
} from './deriveRelations.ts';

const OWNED_CODES = new Set([
  'ELEMENT_HOST_WALL_MISSING',
  'ELEMENT_REGION_AMBIGUOUS',
  'ELEMENT_SIDE_MISMATCH',
  'FACE_NOT_PEOPLE_REACHABLE',
  'FACE_NOT_AIR_REACHABLE',
  'FACE_NO_DIRECT_LIGHT',
]);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function faceIssue(
  faceId: string,
  code:
    | 'FACE_NOT_PEOPLE_REACHABLE'
    | 'FACE_NOT_AIR_REACHABLE'
    | 'FACE_NO_DIRECT_LIGHT',
): BuildingValidationIssue {
  const definitions = {
    FACE_NOT_PEOPLE_REACHABLE: {
      level: 'error' as const,
      message: `Face ${faceId} is not reachable from outside by people.`,
    },
    FACE_NOT_AIR_REACHABLE: {
      level: 'warning' as const,
      message: `Face ${faceId} has no air path to outside.`,
    },
    FACE_NO_DIRECT_LIGHT: {
      level: 'warning' as const,
      message: `Face ${faceId} has no direct light opening to outside.`,
    },
  };
  return {
    id: `${code.toLowerCase()}:${faceId}`,
    code,
    ...definitions[code],
    entity: { type: 'face', id: faceId },
  };
}

export function validateConnectivity(
  document: BuildingDocument,
): BuildingValidationIssue[] {
  const faceIds = Object.keys(document.faces).sort(compareStrings);
  if (faceIds.length === 0) return [];

  const people = reachableFromOutside(
    buildConnectivityGraph(document, 'people'),
  );
  const air = reachableFromOutside(buildConnectivityGraph(document, 'air'));
  const directLight = new Set(
    document.relations
      .filter(
        (relation) =>
          relation.relation_type === 'opening' &&
          relation.to.kind === 'outside' &&
          relation.channels.light,
      )
      .map((relation) => relation.from_face_id),
  );
  const issues: BuildingValidationIssue[] = [];
  for (const faceId of faceIds) {
    if (faceId === 'outside' || !people.has(faceId)) {
      issues.push(faceIssue(faceId, 'FACE_NOT_PEOPLE_REACHABLE'));
    }
    if (faceId === 'outside' || !air.has(faceId)) {
      issues.push(faceIssue(faceId, 'FACE_NOT_AIR_REACHABLE'));
    }
    if (faceId === 'outside' || !directLight.has(faceId)) {
      issues.push(faceIssue(faceId, 'FACE_NO_DIRECT_LIGHT'));
    }
  }
  return issues;
}

export function applyDerivedRelations(
  document: BuildingDocument,
  precomputed?: DeriveRelationsResult,
): BuildingDocument {
  const derived = precomputed ?? deriveRelations(document);
  const withRelations: BuildingDocument = {
    ...document,
    relations: derived.relations,
  };
  const retainedIssues = document.validation.issues.filter(
    (issue) => !OWNED_CODES.has(issue.code),
  );
  return {
    ...withRelations,
    validation: {
      issues: [
        ...retainedIssues,
        ...derived.issues,
        ...validateConnectivity(withRelations),
      ],
    },
  };
}
