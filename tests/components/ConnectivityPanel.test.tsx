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

  it('shows element, relation, channels, and safely edits dimensions in meters', () => {
    render(<ConnectivityPanel elementId="element" />);
    expect(screen.getByText('exterior_window')).toBeTruthy();
    expect(screen.getByText(/air.*light/i)).toBeTruthy();
    const width = screen.getByLabelText('Width (m)');
    fireEvent.change(width, { target: { value: '1.4' } });
    fireEvent.blur(width);
    expect(useEditorStore.getState().buildingDocument!.wall_elements.element.width_mm)
      .toBe(1400);
  });

  it('does not commit an out-of-bounds edit', () => {
    render(<ConnectivityPanel elementId="element" />);
    const offset = screen.getByLabelText('Offset (m)');
    fireEvent.change(offset, { target: { value: '2.5' } });
    fireEvent.blur(offset);
    expect(screen.getByRole('alert').textContent).toContain('端距');
    expect(screen.getByRole('alert').textContent).not.toMatch(/wall|element|offset/i);
    expect(useEditorStore.getState().buildingDocument!.wall_elements.element.offset_from_start_mm)
      .toBe(900);
  });

  it('does not create history for an unchanged blur', () => {
    render(<ConnectivityPanel elementId="element" />);
    fireEvent.blur(screen.getByLabelText('Width (m)'));
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it('commits Enter plus blur exactly once', () => {
    render(<ConnectivityPanel elementId="element" />);
    const width = screen.getByLabelText('Width (m)');
    fireEvent.change(width, { target: { value: '1.4' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    fireEvent.blur(width);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().buildingDocument!.wall_elements.element.width_mm)
      .toBe(1400);
  });

  it('synchronizes inputs after undo and redo without recommitting on blur', () => {
    render(<ConnectivityPanel elementId="element" />);
    const width = screen.getByLabelText('Width (m)');
    fireEvent.change(width, { target: { value: '1.4' } });
    fireEvent.blur(width);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    act(() => useEditorStore.getState().undo());
    expect((screen.getByLabelText('Width (m)') as HTMLInputElement).value).toBe('1.2');
    fireEvent.blur(screen.getByLabelText('Width (m)'));
    expect(useEditorStore.getState().undoStack).toHaveLength(0);

    act(() => useEditorStore.getState().redo());
    expect((screen.getByLabelText('Width (m)') as HTMLInputElement).value).toBe('1.4');
    const historyAfterRedo = useEditorStore.getState().undoStack.length;
    fireEvent.blur(screen.getByLabelText('Width (m)'));
    expect(useEditorStore.getState().undoStack).toHaveLength(historyAfterRedo);
  });

  it('resets drafts when the selected element changes', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.wall_elements.second = {
      ...document.wall_elements.element,
      offset_from_start_mm: 200,
      width_mm: 800,
    };
    const { rerender } = render(<ConnectivityPanel elementId="element" />);
    fireEvent.change(screen.getByLabelText('Width (m)'), { target: { value: '1.7' } });
    rerender(<ConnectivityPanel elementId="second" />);
    expect((screen.getByLabelText('Width (m)') as HTMLInputElement).value).toBe('0.8');
  });
});
