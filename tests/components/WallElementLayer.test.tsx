import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { WallElementLayer } from '../../src/editor/canvas/layers/WallElementLayer.tsx';

describe('WallElementLayer', () => {
  it('renders distinct symbols per element type and selects by keyboard', () => {
    const document = createEmptyBuilding('elements', 'reference.png');
    document.vertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 4000, y_mm: 0 },
    };
    document.walls.wall = {
      start_vertex_id: 'a',
      end_vertex_id: 'b',
      wall_type: 'exterior',
      thickness_mm: 240,
      height_mm: 3000,
      material_type: 'brick',
    };
    for (const [index, element_type] of [
      'exterior_door',
      'exterior_window',
      'interior_door',
      'passage',
    ].entries()) {
      document.wall_elements[`element_${index}`] = {
        element_type,
        host_wall_id: 'wall',
        offset_from_start_mm: index * 900 + 100,
        width_mm: 800,
        height_mm: 2100,
        sill_height_mm: 0,
        status: 'valid',
      };
    }
    const select = vi.fn();
    render(
      <svg>
        <WallElementLayer
          document={document}
          pixelsPerMm={0.1}
          selectedElementId={null}
          selectable
          onSelectElement={select}
        />
      </svg>,
    );

    expect(screen.getByTestId('wall-element-symbol-element_0').getAttribute('data-element-type'))
      .toBe('exterior_door');
    expect(screen.getByTestId('wall-element-symbol-element_1').getAttribute('data-element-type'))
      .toBe('exterior_window');
    expect(screen.getByTestId('wall-element-symbol-element_3').getAttribute('data-element-type'))
      .toBe('passage');

    // 四种构件均为实心矩形；内门额外带两端深色竖线
    expect(screen.getByTestId('wall-element-rect-element_0').getAttribute('fill')).toBe('#f97316');
    expect(screen.getByTestId('wall-element-rect-element_1').getAttribute('fill')).toBe('#0891b2');
    expect(screen.getByTestId('wall-element-rect-element_2').getAttribute('fill')).toBe('#2563eb');
    expect(screen.getByTestId('wall-element-rect-element_3').getAttribute('fill')).toBe('#9333ea');

    // 外门带开启弧；内门「|==|」两端深色竖线
    expect(screen.getByTestId('wall-element-swing-element_0')).toBeTruthy();
    expect(screen.queryByTestId('wall-element-swing-element_2')).toBeNull();
    const doorMarks = screen.getByTestId('wall-element-door-marks-element_2');
    expect(doorMarks.getAttribute('stroke')).toBe('#0f172a');
    expect(doorMarks.getAttribute('stroke-width')).toBe('24');
    const startMark = screen.getByTestId('wall-element-door-mark-start-element_2');
    expect(startMark.getAttribute('x1')).toBe('1900');
    expect(startMark.getAttribute('y1')).toBe('-120');
    expect(startMark.getAttribute('y2')).toBe('120');
    expect(screen.getByTestId('wall-element-door-mark-end-element_2').getAttribute('x1'))
      .toBe('2700');
    expect(screen.queryByTestId('wall-element-door-marks-element_0')).toBeNull();

    const button = screen.getByRole('button', { name: /exterior door element_0/i });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('does not consume middle button or selection while non-selectable', () => {
    const document = createEmptyBuilding('elements', 'reference.png');
    document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 2000, y_mm: 0 } };
    document.walls.wall = {
      start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'exterior',
      thickness_mm: 240, height_mm: 3000, material_type: 'brick',
    };
    document.wall_elements.element = {
      element_type: 'exterior_window', host_wall_id: 'wall',
      offset_from_start_mm: 400, width_mm: 1000, height_mm: 1200,
      sill_height_mm: 900, status: 'valid',
    };
    const select = vi.fn();
    const parent = vi.fn();
    render(<svg onPointerDown={parent}><WallElementLayer
      document={document} pixelsPerMm={0.1} selectedElementId={null}
      selectable={false} onSelectElement={select}
    /></svg>);
    fireEvent.pointerDown(screen.getByTestId('wall-element-hit-element'), { button: 1 });
    expect(select).not.toHaveBeenCalled();
    expect(parent).toHaveBeenCalled();
  });

  it('keeps the hit area constant in screen pixels while door marks use wall units', () => {
    const document = createEmptyBuilding('zoom-elements', 'reference.png');
    document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 2000, y_mm: 0 } };
    document.walls.wall = {
      start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'interior',
      thickness_mm: 240, height_mm: 3000, material_type: 'brick',
    };
    document.wall_elements.element = {
      element_type: 'interior_door', host_wall_id: 'wall',
      offset_from_start_mm: 500, width_mm: 900, height_mm: 2100,
      sill_height_mm: 0, status: 'valid',
    };
    const renderAt = (pixelsPerMm: number) => render(<svg><WallElementLayer
      document={document} pixelsPerMm={pixelsPerMm} selectedElementId={null}
      selectable onSelectElement={() => undefined}
    /></svg>);
    const { unmount } = renderAt(0.05);
    const attributes = () => ({
      hit: screen.getByTestId('wall-element-hit-element').getAttribute('stroke-width'),
      hitVectorEffect: screen.getByTestId('wall-element-hit-element').getAttribute('vector-effect'),
      mark: screen.getByTestId('wall-element-door-marks-element').getAttribute('stroke-width'),
      markVectorEffect: screen.getByTestId('wall-element-door-marks-element').getAttribute('vector-effect'),
    });
    const zoomedOut = attributes();
    unmount();
    renderAt(0.5);
    expect(attributes()).toEqual(zoomedOut);
    expect(zoomedOut).toEqual({
      hit: '14',
      hitVectorEffect: 'non-scaling-stroke',
      mark: '24', // 端竖线宽 = max(16, halfDepth*0.2) = 24mm，随视口缩放
      markVectorEffect: null,
    });
  });

  it('moves an element along its host wall when dragged', () => {
    const document = createEmptyBuilding('drag-elements', 'reference.png');
    document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 4000, y_mm: 0 } };
    document.walls.wall = {
      start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'interior',
      thickness_mm: 240, height_mm: 3000, material_type: 'brick',
    };
    document.wall_elements.element = {
      element_type: 'exterior_window', host_wall_id: 'wall',
      offset_from_start_mm: 500, width_mm: 1000, height_mm: 1200,
      sill_height_mm: 900, status: 'valid',
    };
    const commit = vi.fn();
    render(<svg><WallElementLayer
      document={document} pixelsPerMm={0.1} selectedElementId={null}
      selectable onSelectElement={() => undefined}
      worldPointFromEvent={() => ({ x_mm: 1500, y_mm: 0 })}
      onCommitElementOffset={commit}
    /></svg>);
    const hit = screen.getByTestId('wall-element-hit-element');
    fireEvent.pointerDown(hit, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(hit, { pointerId: 1, clientX: 110, clientY: 100 });
    fireEvent.pointerUp(hit, { pointerId: 1, clientX: 110, clientY: 100 });
    // 投影点 x=1500，构件宽 1000 → 起始偏移 1500-500=1000
    expect(commit).toHaveBeenCalledWith('element', 1000);
  });

  it('does not commit when the drag does not change the offset', () => {
    const document = createEmptyBuilding('drag-elements', 'reference.png');
    document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 4000, y_mm: 0 } };
    document.walls.wall = {
      start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'interior',
      thickness_mm: 240, height_mm: 3000, material_type: 'brick',
    };
    document.wall_elements.element = {
      element_type: 'exterior_window', host_wall_id: 'wall',
      offset_from_start_mm: 1000, width_mm: 1000, height_mm: 1200,
      sill_height_mm: 900, status: 'valid',
    };
    const commit = vi.fn();
    render(<svg><WallElementLayer
      document={document} pixelsPerMm={0.1} selectedElementId={null}
      selectable onSelectElement={() => undefined}
      worldPointFromEvent={() => ({ x_mm: 1500, y_mm: 0 })}
      onCommitElementOffset={commit}
    /></svg>);
    const hit = screen.getByTestId('wall-element-hit-element');
    fireEvent.pointerDown(hit, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(hit, { pointerId: 1, clientX: 110, clientY: 100 });
    fireEvent.pointerUp(hit, { pointerId: 1, clientX: 110, clientY: 100 });
    // 投影到 1500，起始偏移 1500-500=1000，与当前一致 → 不提交
    expect(commit).not.toHaveBeenCalled();
  });
});
