import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { FaceFunctionPanel } from '../../src/editor/panels/FaceFunctionPanel.tsx';
import {
  RURAL_FACE_FUNCTION_PRESETS,
} from '../../src/editor/domain/faceFunctions.ts';
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
  };
});

function loadFace() {
  const document = createEmptyBuilding('house_0001', 'reference/original.png');
  document.vertices = {
    a: { x_mm: 0, y_mm: 0 },
    b: { x_mm: 1000, y_mm: 0 },
    c: { x_mm: 1000, y_mm: 1000 },
  };
  document.faces.face_1 = {
    boundary_vertex_ids: ['a', 'b', 'c'],
    area_mm2: 500_000,
    function_code: null,
    display_name: '',
    color: '',
    local_name: '',
  };
  document.floors[0].face_ids = ['face_1'];
  useEditorStore.getState().loadBuilding(document);
  useEditorStore.getState().setSelection({ type: 'face', id: 'face_1' });
}

describe('FaceFunctionPanel', () => {
  beforeEach(() => {
    loadFace();
    vi.mocked(projectApi.listRoomFunctionTemplates).mockResolvedValue([]);
    vi.mocked(projectApi.createRoomFunctionTemplate).mockReset();
  });

  it('offers only the three cold-region presets and assigns one transactionally', () => {
    expect(RURAL_FACE_FUNCTION_PRESETS.map((item) => item.code)).toEqual([
      'bedroom',
      'living_room',
      'dining_room',
    ]);
    render(<FaceFunctionPanel faceId="face_1" />);
    const beforeUndo = useEditorStore.getState().undoStack.length;

    fireEvent.change(screen.getByLabelText('功能类型'), {
      target: { value: 'bedroom' },
    });

    const face = useEditorStore.getState().buildingDocument!.faces.face_1;
    const preset = RURAL_FACE_FUNCTION_PRESETS.find(
      (item) => item.code === 'bedroom',
    )!;
    expect(face).toMatchObject({
      function_code: preset.code,
      display_name: preset.name,
      color: preset.color,
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(beforeUndo + 1);
  });

  it('displays a legacy built-in value without offering it to new rooms', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.faces.face_1 = {
      ...document.faces.face_1,
      function_code: 'kitchen',
      display_name: '厨房',
      color: '#f6c28b',
    };
    useEditorStore.getState().loadBuilding(document);
    render(<FaceFunctionPanel faceId="face_1" />);

    const historical = screen.getByRole('option', { name: '厨房（历史标注）' });
    expect((screen.getByLabelText('功能类型') as HTMLSelectElement).value).toBe('kitchen');
    expect(historical.hasAttribute('disabled')).toBe(true);
  });

  it('edits local name, notes, and color', () => {
    render(<FaceFunctionPanel faceId="face_1" />);

    fireEvent.change(screen.getByLabelText('本地称呼'), {
      target: { value: '灶间' },
    });
    fireEvent.blur(screen.getByLabelText('本地称呼'));
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '保留土灶' },
    });
    fireEvent.blur(screen.getByLabelText('备注'));
    fireEvent.change(screen.getByLabelText('功能面颜色'), {
      target: { value: '#123456' },
    });

    expect(
      useEditorStore.getState().buildingDocument!.faces.face_1,
    ).toMatchObject({
      local_name: '灶间',
      notes: '保留土灶',
      color: '#123456',
    });
  });

  it('syncs committed drafts after undo and does not recommit stale input on blur', () => {
    render(<FaceFunctionPanel faceId="face_1" />);
    const localName = screen.getByLabelText('本地称呼') as HTMLInputElement;
    const notes = screen.getByLabelText('备注') as HTMLTextAreaElement;

    fireEvent.focus(localName);
    fireEvent.change(localName, { target: { value: '灶间' } });
    fireEvent.blur(localName);
    fireEvent.focus(notes);
    fireEvent.change(notes, { target: { value: '保留土灶' } });
    fireEvent.blur(notes);
    expect(useEditorStore.getState().undoStack).toHaveLength(2);

    act(() => useEditorStore.getState().undo());
    expect(notes.value).toBe('');
    const undoCount = useEditorStore.getState().undoStack.length;
    const changeVersion = useEditorStore.getState().changeVersion;
    fireEvent.blur(notes);
    expect(useEditorStore.getState().undoStack).toHaveLength(undoCount);
    expect(useEditorStore.getState().changeVersion).toBe(changeVersion);

    act(() => useEditorStore.getState().undo());
    expect(localName.value).toBe('');
    fireEvent.blur(localName);
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it('keeps a dirty focused draft during unrelated document updates', () => {
    render(<FaceFunctionPanel faceId="face_1" />);
    const localName = screen.getByLabelText('本地称呼') as HTMLInputElement;
    fireEvent.focus(localName);
    fireEvent.change(localName, { target: { value: '未提交草稿' } });

    act(() =>
      useEditorStore.getState().transact('修改其他字段', (document) => ({
        ...document,
        metadata: { ...document.metadata, revision: 12 },
      })),
    );

    expect(localName.value).toBe('未提交草稿');
  });

  it('rejects an empty name and snapshots a newly created global template', async () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.custom_function_types = [
      { code: 'custom_999999999999999999999', name: '旧类型', color: '#111111' },
    ];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'face', id: 'face_1' });
    render(<FaceFunctionPanel faceId="face_1" />);

    fireEvent.click(screen.getByRole('button', { name: '添加模板并应用' }));
    expect(screen.getByText('名称不能为空')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('自定义功能名称'), {
      target: { value: '粮仓' },
    });
    fireEvent.change(screen.getByLabelText('自定义功能颜色'), {
      target: { value: '#654321' },
    });
    vi.mocked(projectApi.createRoomFunctionTemplate).mockResolvedValue({
      code: 'custom_global_granary',
      name: '粮仓',
      color: '#654321',
    });
    fireEvent.click(screen.getByRole('button', { name: '添加模板并应用' }));

    await waitFor(() => {
      expect(useEditorStore.getState().buildingDocument!.faces.face_1.function_code)
        .toBe('custom_global_granary');
    });
    const next = useEditorStore.getState().buildingDocument!;
    expect(next.custom_function_types.at(-1)).toEqual({
      code: 'custom_global_granary', name: '粮仓', color: '#654321',
    });
    expect(next.faces.face_1).toMatchObject({
      function_code: 'custom_global_granary',
      display_name: '粮仓',
      color: '#654321',
    });
    expect(
      screen.getByRole('option', { name: '粮仓' }).getAttribute('value'),
    ).toBe('custom_global_granary');
  });

  it('loads a reusable global template and snapshots it when assigned', async () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.faces.face_2 = {
      ...document.faces.face_1,
      function_code: 'kitchen',
      display_name: '厨房',
    };
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'face', id: 'face_1' });
    vi.mocked(projectApi.listRoomFunctionTemplates).mockResolvedValue([
      { code: 'custom_global_kang', name: '火炕间', color: '#654321' },
    ]);
    render(<FaceFunctionPanel faceId="face_1" />);
    await screen.findByRole('option', { name: '火炕间' });
    fireEvent.change(screen.getByLabelText('功能类型'), {
      target: { value: 'custom_global_kang' },
    });
    expect(useEditorStore.getState().buildingDocument!.faces.face_1)
      .toMatchObject({ function_code: 'custom_global_kang', display_name: '火炕间' });
    expect(useEditorStore.getState().buildingDocument!.custom_function_types)
      .toContainEqual({ code: 'custom_global_kang', name: '火炕间', color: '#654321' });
  });

  it('uses an inline two-step confirmation and one undo restores the full document', () => {
    const before = structuredClone(
      useEditorStore.getState().buildingDocument!,
    );
    render(<FaceFunctionPanel faceId="face_1" />);

    fireEvent.click(screen.getByRole('button', { name: '标记为外部区域' }));
    expect(screen.getByRole('button', { name: '确认标记' })).toBeTruthy();
    expect(useEditorStore.getState().buildingDocument).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: '确认标记' }));

    expect(useEditorStore.getState().buildingDocument!.faces.face_1).toBeUndefined();
    expect(useEditorStore.getState().selection).toBeNull();
    expect(
      Object.values(
        useEditorStore.getState().buildingDocument!.outside_regions,
      ),
    ).toHaveLength(1);

    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().buildingDocument).toEqual(before);
  });
});
