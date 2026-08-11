import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { applyBuildingTemplate } from '../../src/editor/domain/buildingTemplate.ts';

describe('building template', () => {
  it('creates a 10 by 4.5 meter four-room wall sketch', () => {
    const document = createEmptyBuilding('template', 'reference/original.png');
    document.survey = { village_code: '001', household_code: '0001' };
    const beforeReference = structuredClone(document.reference_image);
    const result = applyBuildingTemplate(document, {
      frontageMm: 10_000,
      depthMm: 4500,
      roomCount: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.document.faces)).toHaveLength(4);
    expect(Object.values(result.document.walls).filter((wall) => wall.wall_type === 'interior')).toHaveLength(3);
    expect(result.document.reference_image).toEqual(beforeReference);
    expect(result.document.survey).toEqual(document.survey);
  });

  it('replaces existing geometry while retaining non-geometry data', () => {
    const document = createEmptyBuilding('template', 'reference/original.png');
    document.vertices.old_a = { x_mm: 0, y_mm: 0 };
    document.vertices.old_b = { x_mm: 1000, y_mm: 0 };
    document.walls.old = {
      start_vertex_id: 'old_a', end_vertex_id: 'old_b', wall_type: 'exterior',
      thickness_mm: 240, height_mm: 3000, material_type: 'brick',
    };
    const result = applyBuildingTemplate(document, {
      frontageMm: 6000,
      depthMm: 4000,
      roomCount: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.walls.old).toBeUndefined();
    expect(Object.keys(result.document.faces)).toHaveLength(2);
    expect(result.document.metadata).toEqual(document.metadata);
  });
});
