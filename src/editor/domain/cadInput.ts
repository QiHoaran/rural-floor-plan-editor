export type MeterParseResult =
  | {
      ok: true;
      millimeters: number;
      normalized: string;
    }
  | {
      ok: false;
      message: string;
    };

export function parseMeters(
  input: string,
  minimumMm = 1,
): MeterParseResult {
  if (!isFiniteSafeInteger(minimumMm) || minimumMm <= 0) {
    return {
      ok: false,
      message: '最短长度必须是正的毫米安全整数',
    };
  }
  const normalizedInput = input.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalizedInput)) {
    return {
      ok: false,
      message: '请输入有效的米制长度，例如 4.5',
    };
  }

  const meters = Number(normalizedInput);
  const millimeters = Math.round(meters * 1000);
  if (
    !Number.isFinite(meters) ||
    !isFiniteSafeInteger(millimeters) ||
    millimeters <= 0
  ) {
    return {
      ok: false,
      message: '长度必须大于 0',
    };
  }
  if (millimeters < minimumMm) {
    return {
      ok: false,
      message: `墙体长度不能小于 ${(minimumMm / 1000).toFixed(2)} m`,
    };
  }

  return {
    ok: true,
    millimeters,
    normalized: (millimeters / 1000).toFixed(3),
  };
}

export function parseCoordinateMeters(input: string): MeterParseResult {
  const normalizedInput = input.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizedInput)) {
    return { ok: false, message: '请输入有效的坐标数字' };
  }
  const meters = Number(normalizedInput);
  const millimeters = Math.round(meters * 1000);
  if (!Number.isFinite(meters) || !Number.isSafeInteger(millimeters)) {
    return { ok: false, message: '坐标必须是有限的毫米安全整数' };
  }
  return {
    ok: true,
    millimeters,
    normalized: (millimeters / 1000).toFixed(3),
  };
}

function isFiniteSafeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value);
}
