import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';

const { polygonIoU } = vi.hoisted(() => ({
  polygonIoU: vi.fn(() => 0),
}));

vi.mock('../../src/editor/topology/polygonGeometry.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/editor/topology/polygonGeometry.ts')>();
  return {
    ...actual,
    polygonIntersectionOverUnion: polygonIoU,
  };
});

import { applyOutsideRegions } from '../../src/editor/topology/outsideRegions.ts';

describe('applyOutsideRegions bounding-box rejection', () => {
  beforeEach(() => polygonIoU.mockClear());

  it('does not invoke polygon IoU for many disjoint region-candidate pairs', () => {
    const document = createEmptyBuilding(
      'house_0001',
      'reference/original.png',
    );
    for (let index = 0; index < 20; index += 1) {
      const offset = index * 10_000;
      document.vertices[`r${index}a`] = { x_mm: offset, y_mm: 0 };
      document.vertices[`r${index}b`] = { x_mm: offset + 1000, y_mm: 0 };
      document.vertices[`r${index}c`] = { x_mm: offset, y_mm: 1000 };
      document.outside_regions[`outside_region_${index}`] = {
        boundary_vertex_ids: [`r${index}a`, `r${index}b`, `r${index}c`],
        region_type: 'courtyard',
      };
      const candidateOffset = 1_000_000 + offset;
      document.vertices[`c${index}a`] = { x_mm: candidateOffset, y_mm: 0 };
      document.vertices[`c${index}b`] = {
        x_mm: candidateOffset + 1000,
        y_mm: 0,
      };
      document.vertices[`c${index}c`] = {
        x_mm: candidateOffset,
        y_mm: 1000,
      };
    }

    applyOutsideRegions(
      document,
      Array.from({ length: 20 }, (_, index) => ({
        boundary_vertex_ids: [`c${index}a`, `c${index}b`, `c${index}c`],
        area_mm2: 500_000,
      })),
    );

    expect(polygonIoU).not.toHaveBeenCalled();
  });
});
