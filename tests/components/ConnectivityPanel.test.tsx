import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { ConnectivityPanel } from '../../src/editor/panels/ConnectivityPanel.tsx';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

describe('ConnectivityPanel', () => {
  beforeEach(() => {
    const document = createEmptyBuilding('panel', 'reference.png');
    document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 3000, y_mm: 0 } };
    document.walls.wall = {
      start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'exterior',
      thickness_mm: 240, height_mm: 3000, material_type: 'brick',
    };
    document.faces.room = {
      boundary_vertex_ids: ['a', 'b', 'c'], area_mm2: 1,
      function_code: null, display_name: 'Room', color: '#fff', local_name: '',
    };
    document.vertices.c = { x_mm: 0, y_mm: 1000 };
    document.wall_elements.element = {
      element_type: 'exterior_window', host_wall_id: 'wall',
      offset_from_start_mm: 900, width_mm: 1200, height_mm: 1200,
      sill_height_mm: 900, status: 'valid',
    };
    document.relations = [{
      relation_type: 'opening', wall_element_id: 'element',
      from_face_id: 'room', to: { kind: 'outside' },
      channels: { people: false, air: true, light: true },
    }];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'wall_element', id: 'element' });
  });

  it('shows relations and edits width and height as one metric dimension', () => {
    render(<ConnectivityPanel elementId="element" />);
    expect(screen.getByText('exterior_window')).toBeTruthy();
    expect(screen.getByText(/air.*light/i)).toBeTruthy();
    const dimensions = screen.getByLabelText('尺寸（宽×高，米）');
    fireEvent.change(dimensions, { target: { value: '1.4*1.5' } });
    fireEvent.blur(dimensions);
    expect(useEditorStore.getState().buildingDocument!.wall_elements.element)
      .toMatchObject({ width_mm: 1400, height_mm: 1500 });
    expect((dimensions as HTMLInputElement).value).toBe('1.4×1.5');
    expect(screen.queryByLabelText('Offset (m)')).toBeNull();
    expect(screen.queryByLabelText('Sill (m)')).toBeNull();
  });

  it('does not commit an out-of-bounds dimension edit', () => {
    render(<ConnectivityPanel elementId="element" />);
    const dimensions = screen.getByLabelText('尺寸（宽×高，米）');
    fireEvent.change(dimensions, { target: { value: '3.1×1.2' } });
    fireEvent.blur(dimensions);
    expect(screen.getByRole('alert').textContent).toContain('墙长');
    expect(useEditorStore.getState().buildingDocument!.wall_elements.element.width_mm)
      .toBe(1200);
  });

  it('does not create history for an unchanged blur', () => {
    render(<ConnectivityPanel elementId="element" />);
    fireEvent.blur(screen.getByLabelText('尺寸（宽×高，米）'));
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it('commits Enter plus blur exactly once', () => {
    render(<ConnectivityPanel elementId="element" />);
    const dimensions = screen.getByLabelText('尺寸（宽×高，米）');
    fireEvent.change(dimensions, { target: { value: '1.4x1.6' } });
    fireEvent.keyDown(dimensions, { key: 'Enter' });
    fireEvent.blur(dimensions);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().buildingDocument!.wall_elements.element.width_mm)
      .toBe(1400);
    expect(useEditorStore.getState().buildingDocument!.wall_elements.element.height_mm)
      .toBe(1600);
  });

  it('synchronizes inputs after undo and redo without recommitting on blur', () => {
    render(<ConnectivityPanel elementId="element" />);
    const dimensions = screen.getByLabelText('尺寸（宽×高，米）');
    fireEvent.change(dimensions, { target: { value: '1.4×1.5' } });
    fireEvent.blur(dimensions);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    act(() => useEditorStore.getState().undo());
    expect((screen.getByLabelText('尺寸（宽×高，米）') as HTMLInputElement).value).toBe('1.2×1.2');
    fireEvent.blur(screen.getByLabelText('尺寸（宽×高，米）'));
    expect(useEditorStore.getState().undoStack).toHaveLength(0);

    act(() => useEditorStore.getState().redo());
    expect((screen.getByLabelText('尺寸（宽×高，米）') as HTMLInputElement).value).toBe('1.4×1.5');
    const historyAfterRedo = useEditorStore.getState().undoStack.length;
    fireEvent.blur(screen.getByLabelText('尺寸（宽×高，米）'));
    expect(useEditorStore.getState().undoStack).toHaveLength(historyAfterRedo);
  });

  it('resets drafts when the selected element changes', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.wall_elements.second = {
      ...document.wall_elements.element,
      offset_from_start_mm: 200,
      width_mm: 800,
      height_mm: 2100,
    };
    const { rerender } = render(<ConnectivityPanel elementId="element" />);
    fireEvent.change(screen.getByLabelText('尺寸（宽×高，米）'), { target: { value: '1.7×2.1' } });
    rerender(<ConnectivityPanel elementId="second" />);
    expect((screen.getByLabelText('尺寸（宽×高，米）') as HTMLInputElement).value).toBe('0.8×2.1');
  });
});
