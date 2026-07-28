import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import {
  applyOutsideRegions,
  markFaceAsOutside,
} from '../../src/editor/topology/outsideRegions.ts';
import type { DerivedFace } from '../../src/editor/topology/faceTraversal.ts';

function rectangleDocument() {
  const document = createEmptyBuilding('house_0001', 'reference/original.png');
  document.vertices = {
    v_1: { x_mm: 0, y_mm: 0 },
    v_2: { x_mm: 1000, y_mm: 0 },
    v_3: { x_mm: 1000, y_mm: 1000 },
    v_4: { x_mm: 0, y_mm: 1000 },
  };
  document.faces.face_1 = {
    boundary_vertex_ids: ['v_1', 'v_2', 'v_3', 'v_4'],
    area_mm2: 1_000_000,
    function_code: 'living_room',
    display_name: '堂屋/客厅',
    color: '#f8d7a6',
    local_name: '正房',
  };
  document.floors[0].face_ids = ['face_1'];
  return document;
}

const candidate = (
  boundary_vertex_ids: string[],
  area_mm2 = 1_000_000,
): DerivedFace => ({ boundary_vertex_ids, area_mm2 });

describe('markFaceAsOutside', () => {
  it('moves a face into a deterministic courtyard outside region immutably', () => {
    const document = rectangleDocument();
    document.outside_regions.outside_region_999999999999999999999999 = {
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3'],
      region_type: 'courtyard',
    };
    const before = structuredClone(document);

    const result = markFaceAsOutside(document, 'face_1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outsideRegionId).toBe(
      'outside_region_1000000000000000000000000',
    );
    expect(result.document.faces.face_1).toBeUndefined();
    expect(result.document.floors[0].face_ids).toEqual([]);
    expect(result.document.outside_regions[result.outsideRegionId]).toEqual({
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3', 'v_4'],
      region_type: 'courtyard',
    });
    expect(document).toEqual(before);
  });

  it('fails explicitly and returns the original document for a missing face', () => {
    const document = rectangleDocument();
    const result = markFaceAsOutside(document, 'missing');

    expect(result).toEqual({
      ok: false,
      document,
      error: 'FACE_NOT_FOUND',
      faceId: 'missing',
    });
  });
});

describe('applyOutsideRegions', () => {
  it('keeps excluding an exact courtyard after rotation and a collinear wall split', () => {
    const document = rectangleDocument();
    const marked = markFaceAsOutside(document, 'face_1');
    if (!marked.ok) throw new Error('fixture setup failed');
    marked.document.vertices.v_5 = { x_mm: 500, y_mm: 0 };

    const result = applyOutsideRegions(marked.document, [
      candidate(['v_3', 'v_4', 'v_1', 'v_5', 'v_2']),
    ]);

    expect(result.faces).toEqual({});
    expect(result.floors[0].face_ids).toEqual([]);
    expect(
      result.outside_regions[marked.outsideRegionId].boundary_vertex_ids,
    ).toEqual(['v_3', 'v_4', 'v_1', 'v_5', 'v_2']);
    expect(result.validation.issues).toEqual([]);
  });

  it('uses a unique high-IoU match after a small geometry move', () => {
    const document = rectangleDocument();
    const marked = markFaceAsOutside(document, 'face_1');
    if (!marked.ok) throw new Error('fixture setup failed');
    marked.document.vertices = {
      ...marked.document.vertices,
      n_1: { x_mm: 20, y_mm: 0 },
      n_2: { x_mm: 1020, y_mm: 0 },
      n_3: { x_mm: 1020, y_mm: 1000 },
      n_4: { x_mm: 20, y_mm: 1000 },
    };

    const result = applyOutsideRegions(marked.document, [
      candidate(['n_1', 'n_2', 'n_3', 'n_4']),
    ]);

    expect(result.faces).toEqual({});
    expect(
      result.outside_regions[marked.outsideRegionId].boundary_vertex_ids,
    ).toEqual(['n_1', 'n_2', 'n_3', 'n_4']);
  });

  it('does not exclude tied split candidates and emits a locatable review warning', () => {
    const document = rectangleDocument();
    document.validation.issues = [
      {
        id: 'face_annotation_review:old',
        level: 'warning',
        code: 'FACE_ANNOTATION_REVIEW',
        message: 'keep me',
      },
      {
        id: 'outside_region_review:stale',
        level: 'warning',
        code: 'OUTSIDE_REGION_REVIEW',
        message: 'replace me',
      },
    ];
    const marked = markFaceAsOutside(document, 'face_1');
    if (!marked.ok) throw new Error('fixture setup failed');
    marked.document.vertices = {
      ...marked.document.vertices,
      mid_bottom: { x_mm: 500, y_mm: 0 },
      mid_top: { x_mm: 500, y_mm: 1000 },
    };

    const result = applyOutsideRegions(marked.document, [
      candidate(['v_1', 'mid_bottom', 'mid_top', 'v_4'], 500_000),
      candidate(['mid_bottom', 'v_2', 'v_3', 'mid_top'], 500_000),
    ]);

    expect(Object.keys(result.faces)).toHaveLength(2);
    expect(result.floors[0].face_ids).toEqual(Object.keys(result.faces).sort());
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({
        id: `outside_region_review:${marked.outsideRegionId}`,
        code: 'OUTSIDE_REGION_REVIEW',
        entity: { type: 'outside_region', id: marked.outsideRegionId },
      }),
    );
    expect(result.validation.issues).not.toContainEqual(
      expect.objectContaining({ code: 'FACE_ANNOTATION_REVIEW' }),
    );
    expect(result.validation.issues).not.toContainEqual(
      expect.objectContaining({ message: 'replace me' }),
    );
  });

  it('matches regions one-to-one in deterministic order', () => {
    const document = rectangleDocument();
    document.outside_regions = {
      outside_region_2: {
        boundary_vertex_ids: ['v_1', 'v_2', 'v_3', 'v_4'],
        region_type: 'courtyard',
      },
      outside_region_1: {
        boundary_vertex_ids: ['v_1', 'v_2', 'v_3', 'v_4'],
        region_type: 'courtyard',
      },
    };
    document.faces = {};
    document.floors[0].face_ids = [];

    const result = applyOutsideRegions(document, [
      candidate(['v_4', 'v_3', 'v_2', 'v_1']),
    ]);

    expect(Object.keys(result.faces)).toHaveLength(1);
    expect(result.validation.issues).toHaveLength(2);
    expect(result.validation.issues.map((issue) => issue.id)).toEqual([
      'outside_region_review:outside_region_1',
      'outside_region_review:outside_region_2',
    ]);
  });

  it('does not mutate the document or derived candidate input', () => {
    const document = rectangleDocument();
    const marked = markFaceAsOutside(document, 'face_1');
    if (!marked.ok) throw new Error('fixture setup failed');
    const candidates = [candidate(['v_1', 'v_2', 'v_3', 'v_4'])];
    const beforeDocument = structuredClone(marked.document);
    const beforeCandidates = structuredClone(candidates);

    applyOutsideRegions(marked.document, candidates);

    expect(marked.document).toEqual(beforeDocument);
    expect(candidates).toEqual(beforeCandidates);
  });

  it('does not allocate an indoor face ID reserved by an outside region', () => {
    const document = rectangleDocument();
    document.faces = {};
    document.floors[0].face_ids = [];
    document.outside_regions = {
      face_0001: {
        boundary_vertex_ids: ['v_1', 'v_2', 'v_3'],
        region_type: 'courtyard',
      },
    };

    const result = applyOutsideRegions(document, [
      candidate(['v_1', 'v_2', 'v_3', 'v_4']),
    ]);

    expect(Object.keys(result.faces)).toEqual(['face_0002']);
  });

  it('does not allocate an outside region ID reserved by a face', () => {
    const document = rectangleDocument();
    document.faces.outside_region_0001 = {
      ...document.faces.face_1,
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3'],
    };

    const result = markFaceAsOutside(document, 'face_1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outsideRegionId).toBe('outside_region_0002');
    }
  });

  it('replaces stale outside and face review warnings while retaining unrelated issues', () => {
    const document = rectangleDocument();
    document.validation.issues = [
      {
        id: 'outside_region_review:stale',
        level: 'warning',
        code: 'OUTSIDE_REGION_REVIEW',
        message: 'stale outside',
      },
      {
        id: 'face_annotation_review:stale',
        level: 'warning',
        code: 'FACE_ANNOTATION_REVIEW',
        message: 'stale face',
      },
      {
        id: 'other',
        level: 'warning',
        code: 'OTHER_WARNING',
        message: 'keep',
      },
    ];

    const result = applyOutsideRegions(document, [
      candidate(['v_1', 'v_2', 'v_3', 'v_4']),
    ]);

    expect(result.validation.issues).toEqual([
      expect.objectContaining({ id: 'other' }),
    ]);
  });
});
