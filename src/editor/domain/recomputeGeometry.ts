import type { BuildingDocument } from './buildingTypes.ts';
import { deriveFaces } from '../topology/faceTraversal.ts';
import { applyOutsideRegions } from '../topology/outsideRegions.ts';
import { applyDerivedRelations } from '../connectivity/connectivityValidation.ts';
import { validateWallElementGeometry } from '../commands/wallElementCommand.ts';

export type RecomputeGeometryResult =
  | { ok: true; document: BuildingDocument }
  | {
      ok: false;
      code:
        | 'ELEMENT_HOST_MISSING'
        | 'ELEMENT_OUT_OF_BOUNDS'
        | 'ELEMENT_OVERLAP';
      elementId: string;
    };

/**
 * Task 9 geometry pipeline. Task 13 should make this the shared boundary for
 * every geometry-changing command; for now only point movement uses it.
 */
export function recomputeGeometry(
  document: BuildingDocument,
): RecomputeGeometryResult {
  const elementFailure = validateWallElementGeometry(document);
  if (elementFailure) return { ok: false, ...elementFailure };
  const withRegionsAndFaces = applyOutsideRegions(
    document,
    deriveFaces(document),
  );
  return {
    ok: true,
    document: applyDerivedRelations(withRegionsAndFaces),
  };
}
