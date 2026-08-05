// ============================================================
// 房间功能标注 — v2.1.0
// 使用集中字典 ROOM_FUNCTION_DICTIONARY
// ============================================================

import type {
  BuildingDocument,
  BuildingFace,
  CustomFunctionType,
} from './buildingTypes.ts';
import { CORE_ROOM_FUNCTION_PRESETS } from './roomFunctionTemplates.ts';

export interface FaceFunctionType {
  code: string;
  name: string;
  color: string;
}

/** 预设功能类型（从字典生成，保留兼容） */
export const RURAL_FACE_FUNCTION_PRESETS: readonly FaceFunctionType[] =
  CORE_ROOM_FUNCTION_PRESETS.map((entry) => ({
    code: entry.code,
    name: entry.name,
    color: entry.color,
  }));

/**
 * 为面片分配功能类型
 */
export function assignFaceFunction(
  face: BuildingFace,
  functionType: FaceFunctionType,
): BuildingFace {
  return {
    ...face,
    function_code: functionType.code,
    display_name: functionType.name,
    color: functionType.color,
  };
}

/**
 * 批量分配房间功能
 */
export function batchAssignFaceFunction(
  document: BuildingDocument,
  faceIds: string[],
  functionType: FaceFunctionType,
): BuildingDocument {
  const updatedFaces = { ...document.faces };
  for (const faceId of faceIds) {
    const face = updatedFaces[faceId];
    if (face) {
      updatedFaces[faceId] = assignFaceFunction(face, functionType);
    }
  }
  return { ...document, faces: updatedFaces };
}

function nextCustomCode(document: BuildingDocument): string {
  const reserved = new Set([
    ...document.custom_function_types.map((type) => type.code),
    ...Object.values(document.faces)
      .map((face) => face.function_code)
      .filter((code): code is string => code !== null),
  ]);
  let maximum = 0n;
  for (const code of reserved) {
    const match = /^custom_(\d+)$/.exec(code);
    if (!match) continue;
    const value = BigInt(match[1]);
    if (value > maximum) maximum = value;
  }
  let code: string;
  do {
    maximum += 1n;
    code = `custom_${maximum}`;
  } while (reserved.has(code));
  return code;
}

export type CreateCustomFaceFunctionResult =
  | { ok: true; document: BuildingDocument; functionType: CustomFunctionType }
  | { ok: false; document: BuildingDocument; error: 'EMPTY_NAME' | 'FACE_NOT_FOUND' };

/**
 * 创建自定义面片功能并分配到指定面片
 */
export function createAndAssignCustomFaceFunction(
  document: BuildingDocument,
  faceId: string,
  name: string,
  color: string,
): CreateCustomFaceFunctionResult {
  const face = document.faces[faceId];
  if (!face) return { ok: false, document, error: 'FACE_NOT_FOUND' };
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, document, error: 'EMPTY_NAME' };
  const functionType = {
    code: nextCustomCode(document),
    name: trimmedName,
    color,
  };
  return {
    ok: true,
    functionType,
    document: {
      ...document,
      custom_function_types: [
        ...document.custom_function_types,
        functionType,
      ],
      faces: {
        ...document.faces,
        [faceId]: assignFaceFunction(face, functionType),
      },
    },
  };
}
