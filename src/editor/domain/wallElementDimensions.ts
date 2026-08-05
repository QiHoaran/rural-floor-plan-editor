export type WallElementDimensionParseResult =
  | { ok: true; widthMm: number; heightMm: number; normalized: string }
  | { ok: false; message: string };

export function parseWallElementDimensions(
  value: string,
): WallElementDimensionParseResult {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)\s*$/.exec(value);
  if (!match) {
    return { ok: false, message: '请输入“宽度×高度”，例如 1.0×2.1' };
  }
  const widthMm = Math.round(Number(match[1].replace(',', '.')) * 1000);
  const heightMm = Math.round(Number(match[2].replace(',', '.')) * 1000);
  if (
    !Number.isSafeInteger(widthMm) ||
    !Number.isSafeInteger(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0
  ) {
    return { ok: false, message: '宽度和高度必须是大于 0 的数字' };
  }
  return {
    ok: true,
    widthMm,
    heightMm,
    normalized: formatWallElementDimensions(widthMm, heightMm),
  };
}

export function formatWallElementDimensions(
  widthMm: number,
  heightMm: number,
): string {
  return `${formatMeters(widthMm)}×${formatMeters(heightMm)}`;
}

function formatMeters(millimeters: number): string {
  return (millimeters / 1000).toFixed(3).replace(/\.?0+$/, '');
}

