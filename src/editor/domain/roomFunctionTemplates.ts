import type {
  BuildingDocument,
  CustomFunctionType,
} from './buildingTypes.ts';
import { ROOM_FUNCTION_DICTIONARY } from './constants.ts';

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
  for (const group of groups) {
    for (const item of group) {
      if (!byCode.has(item.code)) byCode.set(item.code, item);
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
      { ...functionType },
    ],
  };
}

