import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import {
  referenceLocalToWorld,
  rotateReference,
  scaleReference,
  scaleReferenceAround,
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

    expect(scaleReference(image, 1000).transform.scale).toBe(1000);
    expect(scaleReference(image, 0.0001).transform.scale).toBe(0.01);
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

  it('maps a local point through the transform into world mm', () => {
    const image = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    ).reference_image;
    const transform = {
      ...image.transform,
      translate_x_mm: 1000,
      translate_y_mm: -500,
      scale: 2,
      rotation_deg: 0,
    };

    expect(referenceLocalToWorld(transform, { x: 100, y: 50 })).toEqual({
      x: 1200,
      y: -400,
    });
  });

  it('keeps the anchor corner fixed when scaling around a non-origin corner', () => {
    const image = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    ).reference_image;
    const anchor = { x: 400, y: 200 };
    const before = referenceLocalToWorld(image.transform, anchor);

    const scaled = scaleReferenceAround(image, 1.5, anchor);

    expect(scaled.transform.scale).toBe(1.5);
    expect(referenceLocalToWorld(scaled.transform, anchor)).toEqual(before);
  });

  it('compensates translate so the anchor stays fixed even under rotation', () => {
    const image = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    ).reference_image;
    const rotated = {
      ...image.transform,
      translate_x_mm: 1000,
      translate_y_mm: 0,
      rotation_deg: 90,
    };
    const base = { ...image, transform: rotated };
    const anchor = { x: 400, y: 200 };
    const before = referenceLocalToWorld(rotated, anchor);

    const scaled = scaleReferenceAround(base, 2, anchor);

    expect(scaled.transform).toMatchObject({
      scale: 2,
      translate_x_mm: 1200,
      translate_y_mm: -400,
    });
    expect(referenceLocalToWorld(scaled.transform, anchor)).toEqual(before);
  });

  it('clamps the new scale while still preserving the anchor', () => {
    const image = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    ).reference_image;
    const anchor = { x: 10, y: 0 };

    const scaled = scaleReferenceAround(image, 5000, anchor);

    expect(scaled.transform.scale).toBe(1000);
    expect(referenceLocalToWorld(scaled.transform, anchor)).toEqual(
      referenceLocalToWorld(image.transform, anchor),
    );
  });
});
