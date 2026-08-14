import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditablePropertyPanel } from '../../src/editor/panels/EditablePropertyPanel.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import * as projectApi from '../../src/api/projectApi.ts';

vi.mock('../../src/api/projectApi.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/projectApi.ts')>(
    '../../src/api/projectApi.ts',
  );
  return { ...actual, removeReferenceImage: vi.fn() };
});

function loadWall() {
  const document = createEmptyBuilding(
    'house_0001',
    'reference/original.png',
  );
  document.vertices = {
    v_1: { x_mm: 1000, y_mm: 1000 },
    v_2: { x_mm: 5500, y_mm: 1000 },
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
}

describe('EditablePropertyPanel', () => {
  beforeEach(loadWall);

  it('edits wall length in meters while fixing the selected anchor', () => {
    render(<EditablePropertyPanel />);
    expect(screen.queryByLabelText('墙高（米）')).toBeNull();
    const length = screen.getByLabelText('墙长（米）');

    expect((length as HTMLInputElement).value).toBe('4.500');
    fireEvent.change(length, { target: { value: '5.2' } });
    fireEvent.blur(length);

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.vertices.v_1).toEqual({ x_mm: 1000, y_mm: 1000 });
    expect(document.vertices.v_2).toEqual({ x_mm: 6200, y_mm: 1000 });
  });

  it('shows and edits household survey attributes when no geometry is selected', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.reference_image.path = '';
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection(null);
    render(<EditablePropertyPanel />);

    expect(screen.getByLabelText('导入参考草图')).toBeTruthy();
    expect(screen.getByRole('option', { name: '女性' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '2. 女性' })).toBeNull();

    fireEvent.change(screen.getByLabelText('村号（rural）'), { target: { value: '001' } });
    fireEvent.change(screen.getByLabelText('户号（house）'), { target: { value: '0001' } });
    fireEvent.change(screen.getByLabelText('性别'), { target: { value: '女性' } });
    fireEvent.change(screen.getByLabelText('人口结构'), { target: { value: '三代户' } });
    const age = screen.getByLabelText('年龄');
    fireEvent.change(age, { target: { value: '68' } });
    fireEvent.blur(age);
    const clearHeight = screen.getByLabelText('建筑净高（米）');
    fireEvent.change(clearHeight, { target: { value: '2.75' } });
    fireEvent.blur(clearHeight);

    expect(useEditorStore.getState().buildingDocument!.survey).toMatchObject({
      village_code: '001',
      household_code: '0001',
      gender: '女性',
      family_structure: '三代户',
      age: 68,
      clear_height_mm: 2750,
    });
    expect(useEditorStore.getState().buildingDocument!.metadata).toMatchObject({
      village_code: '001',
      household_code: '0001',
    });
    expect(useEditorStore.getState().buildingDocument!.building_defaults.wall_height_mm)
      .toBe(2750);
    expect(useEditorStore.getState().buildingDocument!.walls.w_1.height_mm)
      .toBe(2750);
  });

  it('confirms and removes an existing reference image', async () => {
    useEditorStore.getState().setSelection(null);
    const current = useEditorStore.getState().buildingDocument!;
    current.reference_calibration = {
      calibrated: true,
      point_a_image: { x: 0, y: 0 },
      point_b_image: { x: 100, y: 0 },
      real_distance_mm: 1000,
      mm_per_image_pixel: 10,
      calibrated_at: '2026-08-14T00:00:00.000Z',
    };
    const saved = structuredClone(current);
    saved.reference_image.path = '';
    saved.reference_image.mime_type = 'application/octet-stream';
    saved.reference_image.width_px = 0;
    saved.reference_image.height_px = 0;
    delete saved.reference_calibration;
    saved.metadata.revision += 1;
    vi.mocked(projectApi.removeReferenceImage).mockResolvedValue(saved);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<EditablePropertyPanel />);

    fireEvent.click(screen.getByRole('button', { name: '删除参考图' }));
    await waitFor(() => {
      expect(projectApi.removeReferenceImage).toHaveBeenCalledWith('house_0001');
      expect(screen.getByText('参考图已删除，原文件已备份。')).toBeTruthy();
    });
    expect(useEditorStore.getState().buildingDocument!.reference_image.path).toBe('');
    expect(useEditorStore.getState().buildingDocument!.reference_calibration).toBeUndefined();
  });

  it('can fix the end vertex when changing length', () => {
    render(<EditablePropertyPanel />);
    fireEvent.change(screen.getByLabelText('固定端'), {
      target: { value: 'end' },
    });
    const length = screen.getByLabelText('墙长（米）');
    fireEvent.change(length, { target: { value: '4' } });
    fireEvent.blur(length);

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.vertices.v_1).toEqual({ x_mm: 1500, y_mm: 1000 });
    expect(document.vertices.v_2).toEqual({ x_mm: 5500, y_mm: 1000 });
  });

  it('rejects non-positive thickness without changing the wall', () => {
    render(<EditablePropertyPanel />);
    const thickness = screen.getByLabelText('墙厚（米）');
    fireEvent.change(thickness, { target: { value: '0' } });
    fireEvent.blur(thickness);

    expect(screen.getByText('墙厚必须大于 0')).toBeTruthy();
    expect(
      useEditorStore.getState().buildingDocument!.walls.w_1.thickness_mm,
    ).toBe(370);
  });

  it('edits reference opacity without changing wall vertices', () => {
    const before = structuredClone(
      useEditorStore.getState().buildingDocument!.vertices,
    );
    useEditorStore.getState().setTool('adjust_reference');
    render(<EditablePropertyPanel />);
    const opacity = screen.getByLabelText('透明度');
    fireEvent.change(opacity, { target: { value: '0.3' } });
    fireEvent.blur(opacity);

    const document = useEditorStore.getState().buildingDocument!;
    expect(document.reference_image.opacity).toBe(0.3);
    expect(document.vertices).toEqual(before);
  });

  it('reflects drag-driven transform changes in the reference inputs', () => {
    useEditorStore.getState().setTool('adjust_reference');
    render(<EditablePropertyPanel />);
    const scale = screen.getByLabelText('参考图缩放');
    expect((scale as HTMLInputElement).value).toBe('1');

    // 模拟画布拖拽提交的缩放事务
    act(() =>
      useEditorStore.getState().transact('缩放参考图', (document) => ({
        ...document,
        reference_image: {
          ...document.reference_image,
          transform: {
            ...document.reference_image.transform,
            scale: 5.5,
          },
        },
      })),
    );

    expect((scale as HTMLInputElement).value).toBe('5.5');
    expect(
      (
        screen.getByLabelText('参考图水平位置') as HTMLInputElement
      ).value,
    ).toBe('0');
  });

  it('does not reset the scale when an untouched input is blurred after external changes', () => {
    useEditorStore.getState().setTool('adjust_reference');
    render(<EditablePropertyPanel />);
    act(() =>
      useEditorStore.getState().transact('缩放参考图', (document) => ({
        ...document,
        reference_image: {
          ...document.reference_image,
          transform: {
            ...document.reference_image.transform,
            scale: 5.5,
          },
        },
      })),
    );
    const scale = screen.getByLabelText('参考图缩放');

    fireEvent.focus(scale);
    fireEvent.blur(scale);

    expect(
      useEditorStore.getState().buildingDocument!.reference_image.transform
        .scale,
    ).toBe(5.5);
  });

  it('still commits an edited scale through the input', () => {
    useEditorStore.getState().setTool('adjust_reference');
    render(<EditablePropertyPanel />);
    const scale = screen.getByLabelText('参考图缩放');

    fireEvent.change(scale, { target: { value: '2.5' } });
    fireEvent.blur(scale);

    expect(
      useEditorStore.getState().buildingDocument!.reference_image.transform
        .scale,
    ).toBe(2.5);
    expect((scale as HTMLInputElement).value).toBe('2.5');
  });

  it('shows the face function panel for a selected face', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.vertices.v_3 = { x_mm: 5500, y_mm: 4000 };
    document.faces.face_1 = {
      boundary_vertex_ids: ['v_1', 'v_2', 'v_3'],
      area_mm2: 6_750_000,
      function_code: null,
      display_name: '',
      color: '',
      local_name: '',
    };
    document.floors[0].face_ids = ['face_1'];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'face', id: 'face_1' });

    render(<EditablePropertyPanel />);

    expect(screen.getByText('功能面属性')).toBeTruthy();
    expect(screen.getByLabelText('功能类型')).toBeTruthy();
  });
});
