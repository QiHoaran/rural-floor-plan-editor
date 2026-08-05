import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomLabelPanel } from '../../src/editor/panels/RoomLabelPanel.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import * as projectApi from '../../src/api/projectApi.ts';

vi.mock('../../src/api/projectApi.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/projectApi.ts')>(
    '../../src/api/projectApi.ts',
  );
  return {
    ...actual,
    listRoomFunctionTemplates: vi.fn(),
    createRoomFunctionTemplate: vi.fn(),
    updateRoomFunctionTemplate: vi.fn(),
    deleteRoomFunctionTemplate: vi.fn(),
  };
});

describe('RoomLabelPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const document = createEmptyBuilding('rooms', '');
    document.vertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 1000, y_mm: 0 },
      c: { x_mm: 0, y_mm: 1000 },
    };
    document.faces.room = {
      boundary_vertex_ids: ['a', 'b', 'c'],
      area_mm2: 500_000,
      function_code: null,
      display_name: '',
      color: '#e2e8f0',
      local_name: '',
    };
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'face', id: 'room' });
    vi.mocked(projectApi.listRoomFunctionTemplates).mockResolvedValue([
      { code: 'custom_global_kang', name: '火炕间', color: '#aa5500' },
    ]);
  });

  it('shows three built-ins and preserves a global template snapshot after deletion', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(projectApi.deleteRoomFunctionTemplate).mockResolvedValue();
    render(<RoomLabelPanel />);

    expect(screen.getByRole('button', { name: '卧室' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '客厅' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '餐厅' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '厨房' })).toBeNull();
    const customButton = await screen.findByRole('button', { name: '火炕间' });
    fireEvent.click(customButton);
    expect(useEditorStore.getState().buildingDocument!.faces.room)
      .toMatchObject({ function_code: 'custom_global_kang', display_name: '火炕间' });
    expect(useEditorStore.getState().buildingDocument!.custom_function_types)
      .toContainEqual({ code: 'custom_global_kang', name: '火炕间', color: '#aa5500' });

    fireEvent.click(screen.getByRole('button', { name: '删除模板 火炕间' }));
    await waitFor(() => {
      expect(projectApi.deleteRoomFunctionTemplate).toHaveBeenCalledWith('custom_global_kang');
    });
    expect(useEditorStore.getState().buildingDocument!.faces.room.display_name).toBe('火炕间');
  });

  it('creates and updates reusable templates', async () => {
    vi.mocked(projectApi.createRoomFunctionTemplate).mockResolvedValue({
      code: 'custom_global_store', name: '储藏间', color: '#123456',
    });
    vi.mocked(projectApi.updateRoomFunctionTemplate).mockResolvedValue({
      code: 'custom_global_kang', name: '冬季起居室', color: '#654321',
    });
    render(<RoomLabelPanel />);
    await screen.findByRole('button', { name: '火炕间' });

    fireEvent.change(screen.getByLabelText('自定义模板名称'), {
      target: { value: '储藏间' },
    });
    fireEvent.change(screen.getByLabelText('自定义模板颜色'), {
      target: { value: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加模板' }));
    await screen.findByRole('button', { name: '储藏间' });

    fireEvent.click(screen.getByRole('button', { name: '编辑模板 火炕间' }));
    fireEvent.change(screen.getByLabelText('自定义模板名称'), {
      target: { value: '冬季起居室' },
    });
    fireEvent.change(screen.getByLabelText('自定义模板颜色'), {
      target: { value: '#654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
    await waitFor(() => {
      expect(projectApi.updateRoomFunctionTemplate).toHaveBeenCalledWith(
        'custom_global_kang', { name: '冬季起居室', color: '#654321' },
      );
      expect(screen.getAllByText('冬季起居室').length).toBeGreaterThan(0);
    });
  });
});
