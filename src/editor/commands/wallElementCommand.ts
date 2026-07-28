import type {
  BuildingDocument,
  WallElement,
  WallElementType,
} from '../domain/buildingTypes.ts';
import { deriveRelations } from '../connectivity/deriveRelations.ts';
import { applyDerivedRelations } from '../connectivity/connectivityValidation.ts';

export type WallElementCommandErrorCode =
  | 'ELEMENT_MISSING'
  | 'HOST_MISSING'
  | 'OUT_OF_BOUNDS'
  | 'OVERLAP'
  | 'INVALID_DIMENSIONS'
  | 'SIDE_MISMATCH'
  | 'REGION_AMBIGUOUS';

export const WALL_ELEMENT_ERROR_MESSAGES: Record<
  WallElementCommandErrorCode,
  string
> = {
  ELEMENT_MISSING: '要编辑的墙上构件不存在。',
  HOST_MISSING: '宿主墙或其端点不存在。',
  INVALID_DIMENSIONS:
    '构件尺寸无效：宽高必须为正整数，窗台和偏移必须为非负整数。',
  OUT_OF_BOUNDS: '构件越界：墙体两端必须保留至少 100 mm 端距。',
  OVERLAP: '构件与同一宿主墙上的其他构件重叠。',
  SIDE_MISMATCH: '构件类型与墙体两侧空间关系不匹配。',
  REGION_AMBIGUOUS: '无法唯一确定宿主墙两侧的空间区域。',
};

export interface PlaceWallElementInput {
  element_type: WallElementType;
  host_wall_id: string;
  center_offset_mm: number;
  width_mm: number;
  height_mm: number;
  sill_height_mm: number;
  status?: WallElement['status'];
  notes?: string;
}

export type WallElementCommandResult =
  | { ok: true; document: BuildingDocument; elementId: string }
  | { ok: false; code: WallElementCommandErrorCode; message: string };

const END_CLEARANCE_MM = 100;

export type WallElementGeometryFailure =
  | { code: 'ELEMENT_HOST_MISSING'; elementId: string }
  | { code: 'ELEMENT_OUT_OF_BOUNDS'; elementId: string }
  | { code: 'ELEMENT_OVERLAP'; elementId: string };

/**
 * Geometry-only validation used after a topology edit. Connectivity issues are
 * deliberately handled by applyDerivedRelations and do not reject the edit.
 */
export function validateWallElementGeometry(
  document: BuildingDocument,
): WallElementGeometryFailure | null {
  const byHost = new Map<string, Array<[string, WallElement]>>();
  for (const entry of Object.entries(document.wall_elements).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const [elementId, element] = entry;
    const host = document.walls[element.host_wall_id];
    const start = host && document.vertices[host.start_vertex_id];
    const end = host && document.vertices[host.end_vertex_id];
    if (!host || !start || !end) {
      return { code: 'ELEMENT_HOST_MISSING', elementId };
    }
    const length = Math.hypot(
      end.x_mm - start.x_mm,
      end.y_mm - start.y_mm,
    );
    if (
      !Number.isFinite(length) ||
      element.offset_from_start_mm < END_CLEARANCE_MM ||
      element.offset_from_start_mm + element.width_mm >
        length - END_CLEARANCE_MM
    ) {
      return { code: 'ELEMENT_OUT_OF_BOUNDS', elementId };
    }
    const entries = byHost.get(element.host_wall_id) ?? [];
    entries.push(entry);
    byHost.set(element.host_wall_id, entries);
  }
  for (const entries of byHost.values()) {
    entries.sort(
      ([leftId, left], [rightId, right]) =>
        left.offset_from_start_mm - right.offset_from_start_mm ||
        leftId.localeCompare(rightId),
    );
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1][1];
      const [elementId, current] = entries[index];
      if (
        current.offset_from_start_mm <
        previous.offset_from_start_mm + previous.width_mm
      ) {
        return { code: 'ELEMENT_OVERLAP', elementId };
      }
    }
  }
  return null;
}

export function placeWallElement(
  document: BuildingDocument,
  input: PlaceWallElementInput,
): WallElementCommandResult {
  const elementId = nextElementId(document);
  return validateAndApply(document, elementId, {
    element_type: input.element_type,
    host_wall_id: input.host_wall_id,
    offset_from_start_mm: input.center_offset_mm - input.width_mm / 2,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    sill_height_mm: input.sill_height_mm,
    status: input.status ?? 'valid',
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  });
}

export function updateWallElement(
  document: BuildingDocument,
  elementId: string,
  changes: Partial<WallElement>,
): WallElementCommandResult {
  const current = document.wall_elements[elementId];
  if (!current) {
    return commandError('ELEMENT_MISSING', `Wall element ${elementId} is missing.`);
  }
  return validateAndApply(document, elementId, { ...current, ...changes });
}

function validateAndApply(
  document: BuildingDocument,
  elementId: string,
  element: WallElement,
): WallElementCommandResult {
  const host = document.walls[element.host_wall_id];
  if (!host) return commandError('HOST_MISSING', `Host wall ${element.host_wall_id} is missing.`);
  const start = document.vertices[host.start_vertex_id];
  const end = document.vertices[host.end_vertex_id];
  if (!start || !end) {
    return commandError('HOST_MISSING', `Host wall ${element.host_wall_id} has missing vertices.`);
  }
  const length = Math.hypot(end.x_mm - start.x_mm, end.y_mm - start.y_mm);
  if (!Number.isFinite(length) || length <= 0) {
    return commandError('HOST_MISSING', `Host wall ${element.host_wall_id} has invalid geometry.`);
  }
  if (
    !positiveInteger(element.width_mm) ||
    !positiveInteger(element.height_mm) ||
    !nonNegativeInteger(element.sill_height_mm) ||
    !nonNegativeInteger(element.offset_from_start_mm)
  ) {
    return commandError(
      'INVALID_DIMENSIONS',
      'Width and height must be positive integers; sill and offset must be non-negative integers.',
    );
  }
  const intervalEnd = element.offset_from_start_mm + element.width_mm;
  if (
    element.offset_from_start_mm < END_CLEARANCE_MM ||
    intervalEnd > length - END_CLEARANCE_MM
  ) {
    return commandError(
      'OUT_OF_BOUNDS',
      `Wall elements require ${END_CLEARANCE_MM} mm clearance from both wall ends.`,
    );
  }
  for (const [otherId, other] of Object.entries(document.wall_elements)) {
    if (otherId === elementId || other.host_wall_id !== element.host_wall_id) continue;
    const otherEnd = other.offset_from_start_mm + other.width_mm;
    if (element.offset_from_start_mm < otherEnd && intervalEnd > other.offset_from_start_mm) {
      return commandError('OVERLAP', `Wall element overlaps ${otherId}.`);
    }
  }
  const candidate: BuildingDocument = {
    ...document,
    wall_elements: { ...document.wall_elements, [elementId]: element },
  };
  const derived = deriveRelations(candidate);
  const placementIssue = derived.issues.find(
    (issue) => issue.entity?.type === 'wall_element' && issue.entity.id === elementId,
  );
  if (placementIssue) {
    const code: WallElementCommandErrorCode =
      placementIssue.code === 'ELEMENT_HOST_WALL_MISSING'
        ? 'HOST_MISSING'
        : placementIssue.code === 'ELEMENT_REGION_AMBIGUOUS'
          ? 'REGION_AMBIGUOUS'
          : 'SIDE_MISMATCH';
    return commandError(
      code,
      placementIssue.message,
    );
  }
  return {
    ok: true,
    document: applyDerivedRelations(candidate, derived),
    elementId,
  };
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function nextElementId(document: BuildingDocument): string {
  const ids = new Set(Object.keys(document.wall_elements));
  let maximum = 0n;
  for (const id of ids) {
    const match = /^we_(\d+)$/.exec(id);
    if (!match) continue;
    const value = BigInt(match[1]);
    if (value > maximum) maximum = value;
  }
  let id: string;
  do {
    maximum += 1n;
    id = `we_${String(maximum).padStart(4, '0')}`;
  } while (ids.has(id));
  return id;
}

function commandError(
  code: WallElementCommandErrorCode,
  _message: string,
): WallElementCommandResult {
  return { ok: false, code, message: WALL_ELEMENT_ERROR_MESSAGES[code] };
}
