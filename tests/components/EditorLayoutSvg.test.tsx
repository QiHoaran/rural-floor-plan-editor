import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorLayout } from '../../src/editor/EditorLayout.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import * as imageFile from '../../src/projects/imageFile.ts';

vi.mock('../../src/projects/imageFile.ts', () => ({
  uploadReferenceImageFile: vi.fn(),
}));

describe('EditorLayout SVG integration', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.mocked(imageFile.uploadReferenceImageFile).mockReset();
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

  it('imports a dropped reference image across the editor', async () => {
    const current = useEditorStore.getState().buildingDocument!;
    current.reference_image.path = '';
    useEditorStore.getState().loadBuilding(current);
    const saved = structuredClone(current);
    saved.reference_image.path = 'reference/original.png';
    saved.reference_image.mime_type = 'image/png';
    saved.reference_image.width_px = 800;
    saved.reference_image.height_px = 600;
    vi.mocked(imageFile.uploadReferenceImageFile).mockResolvedValue(saved);
    const { container } = render(<EditorLayout />);
    const file = new File(['png'], 'plan.png', { type: 'image/png' });
    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    await screen.findByText('参考图已导入');
    expect(imageFile.uploadReferenceImageFile).toHaveBeenCalledWith('house_0001', file);
    expect(useEditorStore.getState().buildingDocument!.reference_image.path)
      .toBe('reference/original.png');
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
    expect((screen.getByLabelText('模板正房开间（米）') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('模板正房面宽（米）') as HTMLInputElement).value).toBe('4.5');
    expect((screen.getByLabelText('模板房间数') as HTMLInputElement).value).toBe('4');
    fireEvent.click(screen.getByText('应用模板'));
    expect(Object.keys(useEditorStore.getState().buildingDocument!.faces)).toHaveLength(4);
    expect(useEditorStore.getState().buildingDocument!.survey).toMatchObject({
      main_room_bay_mm: 10000,
      main_room_width_mm: 4500,
      bay_count: 4,
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });

  it('loads template values from survey properties before applying', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.survey = {
      village_code: '1',
      household_code: '2',
      main_room_bay_mm: 12000,
      main_room_width_mm: 5200,
      bay_count: 5,
    };
    useEditorStore.getState().loadBuilding(document);
    render(<EditorLayout />);
    fireEvent.click(screen.getByText('▦ 建筑模板'));
    expect((screen.getByLabelText('模板正房开间（米）') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('模板正房面宽（米）') as HTMLInputElement).value).toBe('5.2');
    expect((screen.getByLabelText('模板房间数') as HTMLInputElement).value).toBe('5');
    fireEvent.click(screen.getByText('取消'));
    expect(useEditorStore.getState().buildingDocument!.survey).toMatchObject({
      main_room_bay_mm: 12000,
      main_room_width_mm: 5200,
      bay_count: 5,
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
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
