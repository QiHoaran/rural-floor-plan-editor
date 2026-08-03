import type { ReferenceImage } from '@/editor/domain/buildingTypes.ts';

/** 参考图缩放钳制范围（与属性面板输入框一致） */
export const REFERENCE_SCALE_MIN = 0.01;
export const REFERENCE_SCALE_MAX = 1000;

/** 参考图局部坐标空间中的一点（未缩放，图像像素坐标，y 向下） */
export interface ReferencePoint {
  x: number;
  y: number;
}

/**
 * 将参考图局部坐标（图像像素）映射到世界坐标（mm）。
 * 对应图层变换 `translate(tx ty) rotate(deg) scale(s)`。
 */
export function referenceLocalToWorld(
  transform: ReferenceImage['transform'],
  point: ReferencePoint,
): ReferencePoint {
  const rad = (transform.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x:
      transform.translate_x_mm +
      transform.scale * (cos * point.x - sin * point.y),
    y:
      transform.translate_y_mm +
      transform.scale * (sin * point.x + cos * point.y),
  };
}

/**
 * 将参考图缩放为绝对倍数 newScale，同时保持局部锚点 anchorLocal 的世界位置不变。
 * 由于 scale 绕局部原点作用，缩放后需反向补偿平移量以钉住锚点。
 */
export function scaleReferenceAround(
  image: ReferenceImage,
  newScale: number,
  anchorLocal: ReferencePoint,
): ReferenceImage {
  const { scale, rotation_deg, translate_x_mm, translate_y_mm } =
    image.transform;
  const clamped = clamp(
    newScale,
    REFERENCE_SCALE_MIN,
    REFERENCE_SCALE_MAX,
  );
  const rad = (rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const anchorRotatedX = cos * anchorLocal.x - sin * anchorLocal.y;
  const anchorRotatedY = sin * anchorLocal.x + cos * anchorLocal.y;
  return {
    ...image,
    transform: {
      ...image.transform,
      scale: clamped,
      translate_x_mm:
        translate_x_mm + (scale - clamped) * anchorRotatedX,
      translate_y_mm:
        translate_y_mm + (scale - clamped) * anchorRotatedY,
    },
  };
}

export function translateReference(
  image: ReferenceImage,
  dxMm: number,
  dyMm: number,
): ReferenceImage {
  return {
    ...image,
    transform: {
      ...image.transform,
      translate_x_mm: image.transform.translate_x_mm + dxMm,
      translate_y_mm: image.transform.translate_y_mm + dyMm,
    },
  };
}

export function scaleReference(
  image: ReferenceImage,
  factor: number,
): ReferenceImage {
  return {
    ...image,
    transform: {
      ...image.transform,
      scale: clamp(
        image.transform.scale * factor,
        REFERENCE_SCALE_MIN,
        REFERENCE_SCALE_MAX,
      ),
    },
  };
}

export function rotateReference(
  image: ReferenceImage,
  degrees: number,
): ReferenceImage {
  return {
    ...image,
    transform: {
      ...image.transform,
      rotation_deg: normalizeDegrees(
        image.transform.rotation_deg + degrees,
      ),
    },
  };
}

export function setReferenceOpacity(
  image: ReferenceImage,
  opacity: number,
): ReferenceImage {
  return {
    ...image,
    opacity: clamp(opacity, 0, 1),
  };
}

function normalizeDegrees(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
