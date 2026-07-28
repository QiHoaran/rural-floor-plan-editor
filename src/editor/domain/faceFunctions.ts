import type {
  BuildingDocument,
  BuildingFace,
  CustomFunctionType,
} from './buildingTypes.ts';

export interface FaceFunctionType {
  code: string;
  name: string;
  color: string;
}

export const RURAL_FACE_FUNCTION_PRESETS: readonly FaceFunctionType[] = [
  { code: 'living_room', name: '堂屋/客厅', color: '#f2c879' },
  { code: 'bedroom', name: '卧室', color: '#c9b8e8' },
  { code: 'kitchen', name: '厨房', color: '#ef9a74' },
  { code: 'dining_room', name: '餐厅', color: '#f4d58d' },
  { code: 'bathroom', name: '卫生间', color: '#89c8d0' },
  { code: 'storage', name: '储藏间', color: '#b7a58c' },
  { code: 'farm_tool_room', name: '农具间', color: '#9eb58f' },
  { code: 'woodshed', name: '柴房', color: '#a98263' },
  { code: 'livestock_room', name: '牲畜房', color: '#c49a6c' },
  { code: 'corridor', name: '走廊', color: '#d5d9df' },
  { code: 'porch', name: '门廊', color: '#a9c5a0' },
  { code: 'other', name: '其他', color: '#cbd5e1' },
] as const;

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
