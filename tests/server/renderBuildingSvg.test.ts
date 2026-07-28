import { describe, expect, it } from 'vitest';
import {
  renderBuildingSvg,
  type RenderSvgOptions,
} from '../../server/renderBuildingSvg.js';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.js';

function defaultOptions(
  overrides?: Partial<RenderSvgOptions>,
): RenderSvgOptions {
  return { pixelsPerMm: 0.477, includeScaleBar: false, ...overrides };
}

describe('renderBuildingSvg', () => {
  it('returns a minimal white SVG for an empty document', () => {
    const doc = createEmptyBuilding(
      'empty',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    const svg = renderBuildingSvg(doc, defaultOptions());
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="100"');
  });

  it('renders a wall polygon', () => {
    const doc = createEmptyBuilding(
      'test',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    doc.vertices.v1 = { x_mm: 0, y_mm: 0 };
    doc.vertices.v2 = { x_mm: 3000, y_mm: 0 };
    doc.walls.w1 = {
      start_vertex_id: 'v1',
      end_vertex_id: 'v2',
      wall_type: 'exterior',
      thickness_mm: 240,
      height_mm: 2800,
      material_type: 'brick',
    };
    doc.floors[0].wall_ids.push('w1');

    const svg = renderBuildingSvg(doc, defaultOptions());
    expect(svg).toContain('<polygon');
    expect(svg).toContain('#334155'); // exterior wall color
  });

  it('renders interior walls with a different color', () => {
    const doc = createEmptyBuilding(
      'test',
      'reference/original.png',
      120,
      '2026-07-27T00:00:00.000Z',
    );
    doc.vertices.v1 = { x_mm: 0, y_mm: 0 };
    doc.vertices.v2 = { x_mm: 2000, y_mm: 0 };
    doc.walls.w1 = {
      start_vertex_id: 'v1',
      end_vertex_id: 'v2',
      wall_type: 'interior',
      thickness_mm: 120,
      height_mm: 2800,
      material_type: 'brick',
    };
    doc.floors[0].wall_ids.push('w1');

    const svg = renderBuildingSvg(doc, defaultOptions());
    expect(svg).toContain('#64748b'); // interior wall color
  });

  it('renders a face polygon with fill', () => {
    const doc = createEmptyBuilding(
      'test',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    // Create a 3-wall U-shape
    doc.vertices.v1 = { x_mm: 0, y_mm: 0 };
    doc.vertices.v2 = { x_mm: 3000, y_mm: 0 };
    doc.vertices.v3 = { x_mm: 3000, y_mm: 4000 };
    doc.vertices.v4 = { x_mm: 0, y_mm: 4000 };
    doc.walls.w1 = {
      start_vertex_id: 'v1', end_vertex_id: 'v2',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w2 = {
      start_vertex_id: 'v2', end_vertex_id: 'v3',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w3 = {
      start_vertex_id: 'v3', end_vertex_id: 'v4',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w4 = {
      start_vertex_id: 'v4', end_vertex_id: 'v1',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.floors[0].wall_ids.push('w1', 'w2', 'w3', 'w4');
    doc.faces.f1 = {
      boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
      area_mm2: 12_000_000,
      function_code: null,
      display_name: '客厅',
      color: '#94a3b8',
      local_name: 'living',
    };
    doc.floors[0].face_ids.push('f1');

    const svg = renderBuildingSvg(doc, defaultOptions());
    expect(svg).toContain('<polygon');
    expect(svg).toContain('fill-opacity="0.32"');
    expect(svg).toContain('客厅');
  });

  it('skips fill for courtyard faces', () => {
    const doc = createEmptyBuilding(
      'test',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    doc.vertices.v1 = { x_mm: 0, y_mm: 0 };
    doc.vertices.v2 = { x_mm: 5000, y_mm: 0 };
    doc.vertices.v3 = { x_mm: 5000, y_mm: 5000 };
    doc.vertices.v4 = { x_mm: 0, y_mm: 5000 };
    doc.walls.w1 = {
      start_vertex_id: 'v1', end_vertex_id: 'v2',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w2 = {
      start_vertex_id: 'v2', end_vertex_id: 'v3',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w3 = {
      start_vertex_id: 'v3', end_vertex_id: 'v4',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w4 = {
      start_vertex_id: 'v4', end_vertex_id: 'v1',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.floors[0].wall_ids.push('w1', 'w2', 'w3', 'w4');
    doc.faces.courtyard = {
      boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
      area_mm2: 25_000_000,
      function_code: null,
      display_name: '院子',
      color: '#94a3b8',
      local_name: 'courtyard',
    };
    doc.outside_regions.c1 = {
      boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
      region_type: 'courtyard',
    };
    doc.floors[0].face_ids.push('courtyard');

    const svg = renderBuildingSvg(doc, defaultOptions());
    // Should NOT contain courtyard fill polygon
    expect(svg).not.toContain('fill-opacity="0.32"');
  });

  it('includes scale bar when requested', () => {
    const doc = createEmptyBuilding(
      'test',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    doc.vertices.v1 = { x_mm: 0, y_mm: 0 };
    doc.vertices.v2 = { x_mm: 5000, y_mm: 0 };
    doc.walls.w1 = {
      start_vertex_id: 'v1', end_vertex_id: 'v2',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.floors[0].wall_ids.push('w1');

    const svgNoBar = renderBuildingSvg(doc, defaultOptions());
    expect(svgNoBar).not.toContain('m</text>');

    const svgWithBar = renderBuildingSvg(
      doc,
      defaultOptions({ includeScaleBar: true }),
    );
    expect(svgWithBar).toContain('m</text>'); // scale bar label
  });

  it('uses different pixelsPerMm for output dimensions', () => {
    const doc = createEmptyBuilding(
      'test',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    doc.vertices.v1 = { x_mm: 0, y_mm: 0 };
    doc.vertices.v2 = { x_mm: 3000, y_mm: 0 };
    doc.walls.w1 = {
      start_vertex_id: 'v1', end_vertex_id: 'v2',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.floors[0].wall_ids.push('w1');

    const coarse = renderBuildingSvg(doc, defaultOptions({ pixelsPerMm: 0.1 }));
    expect(coarse).toContain('width="');

    const fine = renderBuildingSvg(doc, defaultOptions({ pixelsPerMm: 1.0 }));
    expect(fine).toContain('width="');
    // Fine should have larger pixel dimensions
    const coarseMatch = /width="(\d+)"/.exec(coarse);
    const fineMatch = /width="(\d+)"/.exec(fine);
    expect(Number(coarseMatch![1])).toBeLessThan(Number(fineMatch![1]));
  });

  it('escapes XML special characters in face names', () => {
    const doc = createEmptyBuilding(
      'test',
      'reference/original.png',
      240,
      '2026-07-27T00:00:00.000Z',
    );
    doc.vertices.v1 = { x_mm: 0, y_mm: 0 };
    doc.vertices.v2 = { x_mm: 3000, y_mm: 0 };
    doc.vertices.v3 = { x_mm: 3000, y_mm: 3000 };
    doc.vertices.v4 = { x_mm: 0, y_mm: 3000 };
    doc.walls.w1 = {
      start_vertex_id: 'v1', end_vertex_id: 'v2',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w2 = {
      start_vertex_id: 'v2', end_vertex_id: 'v3',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w3 = {
      start_vertex_id: 'v3', end_vertex_id: 'v4',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.walls.w4 = {
      start_vertex_id: 'v4', end_vertex_id: 'v1',
      wall_type: 'exterior', thickness_mm: 240, height_mm: 2800,
      material_type: 'brick',
    };
    doc.floors[0].wall_ids.push('w1', 'w2', 'w3', 'w4');
    doc.faces.f1 = {
      boundary_vertex_ids: ['v1', 'v2', 'v3', 'v4'],
      area_mm2: 9_000_000,
      function_code: null,
      display_name: 'A < B & C',
      color: '#94a3b8',
      local_name: 'test',
    };
    doc.floors[0].face_ids.push('f1');

    const svg = renderBuildingSvg(doc, defaultOptions());
    expect(svg).toContain('A &lt; B &amp; C');
    expect(svg).not.toContain('A < B & C');
  });
});
