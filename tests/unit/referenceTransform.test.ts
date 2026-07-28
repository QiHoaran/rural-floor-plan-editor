import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import {
  rotateReference,
  scaleReference,
  setReferenceOpacity,
  translateReference,
} from '../../src/editor/reference-image/referenceTransform.ts';

describe('reference image transforms', () => {
  it('translates without mutating the source image', () => {
    const image = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    ).reference_image;
    const translated = translateReference(image, 1200, -300);

    expect(translated.transform).toMatchObject({
      translate_x_mm: 1200,
      translate_y_mm: -300,
    });
    expect(image.transform.translate_x_mm).toBe(0);
  });

  it('clamps scale and opacity to safe ranges', () => {
    const image = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    ).reference_image;

    expect(scaleReference(image, 100).transform.scale).toBe(20);
    expect(scaleReference(image, 0.001).transform.scale).toBe(0.05);
    expect(setReferenceOpacity(image, 2).opacity).toBe(1);
    expect(setReferenceOpacity(image, -1).opacity).toBe(0);
  });

  it('normalizes rotation to the -180..180 range', () => {
    const image = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    ).reference_image;

    expect(rotateReference(image, 270).transform.rotation_deg).toBe(-90);
    expect(rotateReference(image, -270).transform.rotation_deg).toBe(90);
  });
});
