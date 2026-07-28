import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { WallElementLayer } from '../../src/editor/canvas/layers/WallElementLayer.tsx';

describe('WallElementLayer', () => {
  it('renders distinct accessible symbols at the stored opening interval and selects by keyboard', () => {
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
    const exteriorDoor = screen.getByTestId('wall-element-primary-element_0');
    const window = screen.getByTestId('wall-element-primary-element_1');
    const interiorDoor = screen.getByTestId('wall-element-primary-element_2');
    const passage = screen.getByTestId('wall-element-primary-element_3');
    expect(exteriorDoor.getAttribute('stroke')).toBe('#f97316');
    expect(exteriorDoor.getAttribute('stroke-dasharray')).toBeNull();
    expect(interiorDoor.getAttribute('stroke')).toBe('#2563eb');
    expect(interiorDoor.getAttribute('stroke-dasharray')).not.toBeNull();
    expect(window.getAttribute('stroke')).toBe('#0891b2');
    expect(screen.getByTestId('wall-element-window-second-element_1')).toBeTruthy();
    expect(passage.getAttribute('stroke')).toBe('#9333ea');
    expect(screen.getByTestId('wall-element-passage-bracket-element_3')).toBeTruthy();
    expect(screen.getByTestId('wall-element-exterior-marker-element_0')).toBeTruthy();
    expect(screen.queryByTestId('wall-element-exterior-marker-element_2')).toBeNull();
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

  it('keeps strokes, hit width, and dash lengths constant in screen pixels across zoom', () => {
    const document = createEmptyBuilding('zoom-elements', 'reference.png');
    document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 2000, y_mm: 0 } };
    document.walls.wall = {
      start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'interior',
      thickness_mm: 120, height_mm: 3000, material_type: 'brick',
    };
    document.wall_elements.element = {
      element_type: 'interior_door', host_wall_id: 'wall',
      offset_from_start_mm: 500, width_mm: 900, height_mm: 2100,
      sill_height_mm: 0, status: 'valid',
    };
    const { rerender } = render(<svg><WallElementLayer
      document={document} pixelsPerMm={0.05} selectedElementId={null}
      selectable onSelectElement={() => undefined}
    /></svg>);
    const attributes = () => ({
      stroke: screen.getByTestId('wall-element-primary-element').getAttribute('stroke-width'),
      dash: screen.getByTestId('wall-element-primary-element').getAttribute('stroke-dasharray'),
      hit: screen.getByTestId('wall-element-hit-element').getAttribute('stroke-width'),
      hitVectorEffect: screen.getByTestId('wall-element-hit-element').getAttribute('vector-effect'),
      swing: screen.getByTestId('wall-element-swing-element').getAttribute('stroke-width'),
    });
    const zoomedOut = attributes();
    rerender(<svg><WallElementLayer
      document={document} pixelsPerMm={0.5} selectedElementId={null}
      selectable onSelectElement={() => undefined}
    /></svg>);
    expect(attributes()).toEqual(zoomedOut);
    expect(zoomedOut).toEqual({
      stroke: '3',
      dash: '6 3.5',
      hit: '14',
      hitVectorEffect: 'non-scaling-stroke',
      swing: '2',
    });
  });
});
