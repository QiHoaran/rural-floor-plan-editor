import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { FaceFunctionPanel } from '../../src/editor/panels/FaceFunctionPanel.tsx';
import {
  RURAL_FACE_FUNCTION_PRESETS,
} from '../../src/editor/domain/faceFunctions.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';

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
  beforeEach(loadFace);

  it('offers stable rural presets without courtyard and assigns one transactionally', () => {
    expect(RURAL_FACE_FUNCTION_PRESETS.map((item) => item.code)).toEqual([
      'living_room',
      'bedroom',
      'kitchen',
      'dining_room',
      'toilet',
      'bathroom',
      'storage',
      'corridor',
      'staircase',
      'utility_room',
      'livestock_room',
      'agricultural',
      'garage',
      'courtyard',
      'other',
      'unknown',
    ]);
    render(<FaceFunctionPanel faceId="face_1" />);
    const beforeUndo = useEditorStore.getState().undoStack.length;

    fireEvent.change(screen.getByLabelText('功能类型'), {
      target: { value: 'kitchen' },
    });

    const face = useEditorStore.getState().buildingDocument!.faces.face_1;
    const preset = RURAL_FACE_FUNCTION_PRESETS.find(
      (item) => item.code === 'kitchen',
    )!;
    expect(face).toMatchObject({
      function_code: preset.code,
      display_name: preset.name,
      color: preset.color,
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(beforeUndo + 1);
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

  it('rejects an empty custom name and creates a reusable collision-free custom type', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.custom_function_types = [
      { code: 'custom_999999999999999999999', name: '旧类型', color: '#111111' },
    ];
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'face', id: 'face_1' });
    render(<FaceFunctionPanel faceId="face_1" />);

    fireEvent.click(screen.getByRole('button', { name: '添加自定义功能' }));
    expect(screen.getByText('名称不能为空')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('自定义功能名称'), {
      target: { value: '粮仓' },
    });
    fireEvent.change(screen.getByLabelText('自定义功能颜色'), {
      target: { value: '#654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加自定义功能' }));

    const next = useEditorStore.getState().buildingDocument!;
    expect(next.custom_function_types.at(-1)).toEqual({
      code: 'custom_1000000000000000000000',
      name: '粮仓',
      color: '#654321',
    });
    expect(next.faces.face_1).toMatchObject({
      function_code: 'custom_1000000000000000000000',
      display_name: '粮仓',
      color: '#654321',
    });
    expect(
      screen.getByRole('option', { name: '粮仓' }).getAttribute('value'),
    ).toBe('custom_1000000000000000000000');
  });

  it('avoids custom codes already referenced by another face in the building', () => {
    const document = useEditorStore.getState().buildingDocument!;
    document.faces.face_2 = {
      ...document.faces.face_1,
      function_code: 'custom_1',
      display_name: '遗留自定义类型',
    };
    useEditorStore.getState().loadBuilding(document);
    useEditorStore.getState().setSelection({ type: 'face', id: 'face_1' });
    render(<FaceFunctionPanel faceId="face_1" />);

    fireEvent.change(screen.getByLabelText('自定义功能名称'), {
      target: { value: '粮仓' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加自定义功能' }));

    expect(
      useEditorStore.getState().buildingDocument!.faces.face_1.function_code,
    ).toBe('custom_2');
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
