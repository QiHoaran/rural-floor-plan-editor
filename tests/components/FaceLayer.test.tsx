import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FaceLayer } from '../../src/editor/canvas/layers/FaceLayer.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';

function faceDocument() {
  const document = createEmptyBuilding('house_0001', 'reference/original.png');
  document.vertices = {
    a: { x_mm: 0, y_mm: 0 },
    b: { x_mm: 1000, y_mm: 0 },
    c: { x_mm: 1000, y_mm: 1000 },
    d: { x_mm: 0, y_mm: 1000 },
  };
  document.faces.face_1 = {
    boundary_vertex_ids: ['a', 'b', 'c', 'd'],
    area_mm2: 1_000_000,
    function_code: 'living_room',
    display_name: '堂屋/客厅',
    color: '#ff0000',
    local_name: '',
  };
  document.outside_regions.yard = {
    boundary_vertex_ids: ['a', 'b', 'c', 'd'],
    region_type: 'courtyard',
  };
  return document;
}

describe('FaceLayer', () => {
  it('renders only indoor faces with safe translucent color and labels', () => {
    render(
      <svg>
        <FaceLayer
          document={faceDocument()}
          selectedFaceId={null}
          selectable
          onSelectFace={() => undefined}
        />
      </svg>,
    );

    expect(
      screen.getByTestId('face-polygon-face_1').getAttribute('fill'),
    ).toBe('#ff0000');
    expect(
      screen.getByTestId('face-polygon-face_1').getAttribute('fill-opacity'),
    ).toBe('0.32');
    expect(screen.getByText('堂屋/客厅')).toBeTruthy();
    expect(screen.queryByTestId('face-polygon-yard')).toBeNull();
  });

  it('selects only in select mode and stops the canvas pointer handler', () => {
    const select = vi.fn();
    const canvasPointer = vi.fn();
    const { rerender } = render(
      <svg onPointerDown={canvasPointer}>
        <FaceLayer
          document={faceDocument()}
          selectedFaceId="face_1"
          selectable
          onSelectFace={select}
        />
      </svg>,
    );

    const polygon = screen.getByTestId('face-polygon-face_1');
    expect(polygon.getAttribute('stroke-width')).toBe('3');
    fireEvent.pointerDown(polygon);
    expect(select).toHaveBeenCalledWith('face_1');
    expect(canvasPointer).not.toHaveBeenCalled();

    rerender(
      <svg onPointerDown={canvasPointer}>
        <FaceLayer
          document={faceDocument()}
          selectedFaceId={null}
          selectable={false}
          onSelectFace={select}
        />
      </svg>,
    );
    fireEvent.pointerDown(screen.getByTestId('face-polygon-face_1'));
    expect(select).toHaveBeenCalledTimes(1);
    expect(canvasPointer).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible named button and supports Enter and Space selection', () => {
    const select = vi.fn();
    render(
      <svg>
        <FaceLayer
          document={faceDocument()}
          selectedFaceId={null}
          selectable
          onSelectFace={select}
        />
      </svg>,
    );
    const face = screen.getByRole('button', { name: '堂屋/客厅' });

    expect(face.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(face, { key: 'Enter' });
    fireEvent.keyDown(face, { key: ' ' });

    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenNthCalledWith(1, 'face_1');
  });
});
