// ============================================================
// 集中式单位转换 — 禁止在组件中散落 /1000、*1000
//
// 内部统一单位：毫米 (mm)
// 像素仅用于参考图显示和屏幕坐标变换
// ============================================================

import type { Millimeters } from './buildingTypes.ts';

/** 毫米转米 */
export function mmToMeters(mm: Millimeters): number {
  return mm / 1000;
}

/** 米转毫米 */
export function metersToMm(meters: number): Millimeters {
  return Math.round(meters * 1000);
}

/** 厘米转毫米 */
export function cmToMm(cm: number): Millimeters {
  return Math.round(cm * 10);
}

/** 毫米转厘米 */
export function mmToCm(mm: Millimeters): number {
  return mm / 10;
}

/** 毫米转显示字符串（米），用于 UI 输入框 */
export function mmToDisplay(mm: Millimeters): string {
  return (mm / 1000).toFixed(3);
}

/**
 * 解析用户输入的长度字符串，支持：
 * - "4200 mm" → 4200
 * - "420 cm" → 4200
 * - "4.2 m" → 4200
 * - "4.2" → 4200（默认单位为米）
 * - "4200" → 4200（如果 parseAsMm 为 true）
 */
export type LengthParseResult = {
  ok: true;
  millimeters: number;
  normalized: string;
  sourceUnit: 'mm' | 'cm' | 'm';
} | {
  ok: false;
  message: string;
};

const UNIT_PATTERN = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)?\s*$/i;

export function parseLengthInput(input: string): LengthParseResult {
  const trimmed = input.trim().replace(',', '.');
  const match = trimmed.match(UNIT_PATTERN);

  if (!match) {
    return {
      ok: false,
      message: '请输入有效的长度，例如 4.2 m、420 cm 或 4200 mm',
    };
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, message: '长度必须是非负数字' };
  }

  const unit = (match[2]?.toLowerCase() ?? 'm') as 'mm' | 'cm' | 'm';
  let millimeters: number;

  switch (unit) {
    case 'mm':
      millimeters = Math.round(value);
      break;
    case 'cm':
      millimeters = Math.round(value * 10);
      break;
    case 'm':
    default:
      millimeters = Math.round(value * 1000);
      break;
  }

  if (!Number.isSafeInteger(millimeters) || millimeters < 0) {
    return { ok: false, message: '长度值过大或无效' };
  }

  return {
    ok: true,
    millimeters,
    normalized: (millimeters / 1000).toFixed(3),
    sourceUnit: unit,
  };
}

/**
 * 将角度标准化到 [0, 360) 范围
 */
export function normalizeAngleDeg(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * 验证毫米坐标是否为安全整数
 */
export function isValidMmCoordinate(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value);
}
