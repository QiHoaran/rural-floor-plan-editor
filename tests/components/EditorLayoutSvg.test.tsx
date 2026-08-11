import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorLayout } from '../../src/editor/EditorLayout.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

describe('EditorLayout SVG integration', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadBuilding(
        createEmptyBuilding('house_0001', 'reference/original.png'),
      );
  });

  it('mounts the SVG CAD canvas for the active building', () => {
    render(<EditorLayout />);

    expect(screen.getByTestId('svg-canvas')).toBeTruthy();
    expect(screen.getByText('house_0001')).toBeTruthy();
  });

  it('shows editable properties for a selected wall', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices = {
      v_1: { x_mm: 0, y_mm: 0 },
      v_2: { x_mm: 3000, y_mm: 0 },
    };
    document.walls = {
      w_1: {
        start_vertex_id: 'v_1',
        end_vertex_id: 'v_2',
        wall_type: 'exterior',
        thickness_mm: 370,
        height_mm: 3000,
        material_type: 'brick',
      },
    };
    document.floors[0].wall_ids = ['w_1'];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore
      .getState()
      .setSelection({ type: 'wall', id: 'w_1' });

    render(<EditorLayout />);

    expect(screen.getByLabelText('墙长（米）')).toBeTruthy();
  });

  it('handles Ctrl+Z once through the editor-level shortcut', () => {
    useEditorStore.getState().transact('first', (document) => ({
      ...document,
      vertices: { first: { x_mm: 1, y_mm: 1 } },
    }));
    useEditorStore.getState().transact('second', (document) => ({
      ...document,
      vertices: { ...document.vertices, second: { x_mm: 2, y_mm: 2 } },
    }));
    render(<EditorLayout />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(useEditorStore.getState().buildingDocument?.vertices.first).toBeTruthy();
    expect(useEditorStore.getState().buildingDocument?.vertices.second).toBeUndefined();
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(useEditorStore.getState().buildingDocument?.vertices.second).toEqual({
      x_mm: 2,
      y_mm: 2,
    });
    expect(useEditorStore.getState().redoStack).toHaveLength(0);
  });

  it('applies the default building template as one undoable transaction', () => {
    render(<EditorLayout />);
    fireEvent.click(screen.getByText('▦ 建筑模板'));
    expect((screen.getByLabelText('模板面宽（米）') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('模板深度（米）') as HTMLInputElement).value).toBe('4.5');
    expect((screen.getByLabelText('模板房间数') as HTMLInputElement).value).toBe('4');
    fireEvent.click(screen.getByText('应用模板'));
    expect(Object.keys(useEditorStore.getState().buildingDocument!.faces)).toHaveLength(4);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });

  it('warns before replacing a non-empty sketch with a template', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices = {
      old_a: { x_mm: 0, y_mm: 0 },
      old_b: { x_mm: 1000, y_mm: 0 },
    };
    document.walls.old = {
      start_vertex_id: 'old_a', end_vertex_id: 'old_b', wall_type: 'exterior',
      thickness_mm: 240, height_mm: 3000, material_type: 'brick',
    };
    useEditorStore.getState().loadBuilding(document);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<EditorLayout />);
    fireEvent.click(screen.getByText('▦ 建筑模板'));
    fireEvent.click(screen.getByText('应用模板'));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(useEditorStore.getState().buildingDocument!.walls.old).toBeUndefined();
  });
});
