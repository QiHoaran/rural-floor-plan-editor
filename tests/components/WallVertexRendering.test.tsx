import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { WallLayer } from '../../src/editor/canvas/layers/WallLayer.tsx';
import { VertexLayer } from '../../src/editor/canvas/layers/VertexLayer.tsx';

afterEach(cleanup);

function fixture() {
  const document = createEmptyBuilding('render-test', 'reference/original.png');
  document.vertices = {
    a: { x_mm: -1000, y_mm: 0 }, b: { x_mm: 1000, y_mm: 0 },
    c: { x_mm: 0, y_mm: 0 }, d: { x_mm: 0, y_mm: 1000 },
    isolated: { x_mm: 2000, y_mm: 2000 },
  };
  document.walls = {
    outer: { start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'exterior', thickness_mm: 370, height_mm: 3000, material_type: 'brick' },
    inner: { start_vertex_id: 'c', end_vertex_id: 'd', wall_type: 'interior', thickness_mm: 120, height_mm: 3000, material_type: 'brick' },
  };
  return document;
}

describe('wall compositing', () => {
  for (const shape of ['T', 'cross', 'diagonal']) {
    it.each([false, true])(`${shape} keeps exterior above selected interior (reverse=%s)`, (reverse) => {
      const document = fixture();
      if (shape === 'cross') document.vertices.c.y_mm = -1000;
      if (shape === 'diagonal') document.vertices.d.x_mm = 1000;
      if (reverse) document.walls = Object.fromEntries(Object.entries(document.walls).reverse());
      const before = structuredClone(document);
      const { container } = render(<svg><WallLayer document={document} pixelsPerMm={0.1} selectedWallId="inner" onSelectWall={vi.fn()} /></svg>);
      expect([...container.querySelectorAll('polygon')].map((node) => node.dataset.testid)).toEqual(['wall-polygon-inner', 'wall-polygon-outer']);
      expect(screen.getByTestId('wall-polygon-outer').getAttribute('points')).toBe('-1000,185 1000,185 1000,-185 -1000,-185');
      expect(screen.getByTestId('wall-polygon-inner').getAttribute('stroke')).toBe('#2563eb');
      expect(document).toEqual(before);
    });
  }

  it('preserves same-class order and wall selection', () => {
    const document = fixture();
    document.walls.partition = { ...document.walls.inner, wall_type: 'partition' };
    document.walls.outer2 = { ...document.walls.outer };
    const onSelectWall = vi.fn();
    const { container } = render(<svg><WallLayer document={document} pixelsPerMm={0.1} selectedWallId={null} onSelectWall={onSelectWall} /></svg>);
    expect([...container.querySelectorAll('polygon')].map((node) => node.dataset.testid)).toEqual(['wall-polygon-inner', 'wall-polygon-partition', 'wall-polygon-outer', 'wall-polygon-outer2']);
    fireEvent.pointerDown(screen.getByTestId('wall-hit-inner'));
    expect(onSelectWall).toHaveBeenCalledWith('inner');
  });
});

describe('square vertices', () => {
  it.each([0.01, 0.1, 1])('uses connected thickness and a 16px minimum at scale %s', (pixelsPerMm) => {
    const document = fixture();
    document.walls.inner.start_vertex_id = 'a';
    render(<svg><VertexLayer document={document} pixelsPerMm={pixelsPerMm} selectedVertexId={null} onSelectVertex={vi.fn()} onStartDrag={vi.fn()} /></svg>);
    for (const [id, thickness] of [['a', 370], ['d', 120], ['isolated', document.building_defaults.wall_thickness_mm]] as const) {
      const side = Math.max(thickness, 16 / pixelsPerMm);
      const visual = screen.getByTestId(`vertex-visual-${id}`);
      const hit = screen.getByTestId(`vertex-hit-${id}`);
      expect(visual.tagName).toBe('rect');
      expect(hit.tagName).toBe('rect');
      expect(Number(visual.getAttribute('width'))).toBe(side);
      expect(Number(visual.getAttribute('height'))).toBe(side);
      expect(Number(visual.getAttribute('x'))).toBe(document.vertices[id].x_mm - side / 2);
      expect(Number(visual.getAttribute('y'))).toBe(document.vertices[id].y_mm - side / 2);
      expect(Number(hit.getAttribute('width'))).toBe(side + 16 / pixelsPerMm);
    }
  });

  it('preserves selection, dragging, keyboard and disabled interaction', () => {
    const props = { document: fixture(), pixelsPerMm: 0.1, selectedVertexId: 'a', onSelectVertex: vi.fn(), onStartDrag: vi.fn() };
    const { rerender } = render(<svg><VertexLayer {...props} /></svg>);
    const hit = screen.getByTestId('vertex-hit-a');
    expect(hit.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('vertex-visual-a').getAttribute('fill')).toBe('#2563eb');
    fireEvent(hit, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(props.onSelectVertex).toHaveBeenCalledWith('a');
    expect(props.onStartDrag).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(hit, { key: 'Enter' });
    fireEvent.keyDown(hit, { key: ' ' });
    expect(props.onSelectVertex).toHaveBeenCalledTimes(3);
    rerender(<svg><VertexLayer {...props} selectable={false} /></svg>);
    fireEvent(hit, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    fireEvent.keyDown(hit, { key: 'Enter' });
    expect(props.onSelectVertex).toHaveBeenCalledTimes(3);
  });
});
