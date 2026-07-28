import type { ReferenceImage } from '@/editor/domain/buildingTypes.ts';

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
      scale: clamp(image.transform.scale * factor, 0.05, 20),
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
