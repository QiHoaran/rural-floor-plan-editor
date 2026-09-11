import type {
  BuildingDocument,
  CustomFunctionType,
} from './buildingTypes.ts';
import { ROOM_FUNCTION_DICTIONARY } from './constants.ts';

/** Global catalog metadata; never copied into building snapshots. */
export interface RoomFunctionTemplate extends CustomFunctionType {
  is_builtin?: boolean;
}

export const normalizeFunctionName = (name: string): string => name.trim().toLowerCase();

export const CORE_ROOM_FUNCTION_CODES = [
  'bedroom',
  'living_room',
  'dining_room',
] as const;

export const CORE_ROOM_FUNCTION_PRESETS: readonly CustomFunctionType[] =
  CORE_ROOM_FUNCTION_CODES.map((code) => {
    const entry = ROOM_FUNCTION_DICTIONARY.find((item) => item.code === code)!;
    return { code: entry.code, name: entry.name, color: entry.color };
  });

export function mergeRoomFunctionTypes(
  ...groups: readonly (readonly CustomFunctionType[])[]
): CustomFunctionType[] {
  const byCode = new Map<string, CustomFunctionType>();
  const names = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      const name = normalizeFunctionName(item.name);
      if (!byCode.has(item.code) && !names.has(name)) {
        byCode.set(item.code, item);
        names.add(name);
      }
    }
  }
  return [...byCode.values()];
}

/** 将全局模板复制到建筑 JSON，保证全局模板变化后历史标注仍可显示。 */
export function ensureRoomFunctionSnapshot(
  document: BuildingDocument,
  functionType: CustomFunctionType,
): BuildingDocument {
  if (CORE_ROOM_FUNCTION_CODES.includes(
    functionType.code as (typeof CORE_ROOM_FUNCTION_CODES)[number],
  )) {
    return document;
  }
  const existing = document.custom_function_types.find(
    (item) => item.code === functionType.code,
  );
  if (
    existing?.name === functionType.name &&
    existing.color === functionType.color
  ) {
    return document;
  }
  return {
    ...document,
    custom_function_types: [
      ...document.custom_function_types.filter(
        (item) => item.code !== functionType.code,
      ),
      { code: functionType.code, name: functionType.name, color: functionType.color },
    ],
  };
}

export function roomFunctionCatalog(templates: readonly RoomFunctionTemplate[]): RoomFunctionTemplate[] {
  return mergeRoomFunctionTypes(
    CORE_ROOM_FUNCTION_PRESETS,
    templates.filter((item) => item.is_builtin),
    templates.filter((item) => !item.is_builtin),
  );
}

/** Only functions actually used by faces are eligible for automatic recovery. */
export function usedRoomFunctions(document: BuildingDocument): CustomFunctionType[] {
  return mergeRoomFunctionTypes(Object.values(document.faces).flatMap((face) => {
    if (!face.function_code || face.function_code === 'unknown') return [];
    const snapshot = document.custom_function_types.find((item) => item.code === face.function_code);
    const preset = ROOM_FUNCTION_DICTIONARY.find((item) => item.code === face.function_code);
    return [{ code: face.function_code, name: snapshot?.name || face.display_name || preset?.name || face.function_code,
      color: face.color || snapshot?.color || preset?.color || '#94a3b8' }];
  }));
}

export function reconcileRoomFunctions(document: BuildingDocument, catalog: readonly CustomFunctionType[], aliases: ReadonlyMap<string, string> = new Map()): BuildingDocument {
  if (document.workflow.status === 'complete' || document.metadata.status === 'complete') return document;
  const byCode = new Map(catalog.map((item) => [item.code, item]));
  const byName = new Map(catalog.map((item) => [normalizeFunctionName(item.name), item]));
  let next = document;
  for (const [id, face] of Object.entries(document.faces)) {
    if (!face.function_code || face.function_code === 'unknown') continue;
    const snapshot = document.custom_function_types.find((item) => item.code === face.function_code);
    const preset = ROOM_FUNCTION_DICTIONARY.find((item) => item.code === face.function_code);
    const target = byCode.get(aliases.get(face.function_code) ?? face.function_code)
      ?? byName.get(normalizeFunctionName(snapshot?.name || face.display_name || preset?.name || face.function_code));
    if (!target) continue;
    next = ensureRoomFunctionSnapshot(next, target);
    if (face.function_code !== target.code || face.display_name !== target.name || face.color !== target.color) {
      next = { ...next, faces: { ...next.faces, [id]: { ...face, function_code: target.code, display_name: target.name, color: target.color } } };
    }
  }
  const usedCodes = new Set(Object.values(next.faces).map((face) => face.function_code));
  const snapshots = next.custom_function_types.filter((item) => {
    const target = byName.get(normalizeFunctionName(item.name));
    return !target || target.code === item.code || usedCodes.has(item.code);
  });
  if (snapshots.length !== next.custom_function_types.length) next = { ...next, custom_function_types: snapshots };
  return next;
}

