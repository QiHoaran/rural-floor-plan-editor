import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { DataQualityPanel } from '../../src/editor/panels/DataQualityPanel.tsx';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { createValidationIssue } from '../../src/editor/domain/buildingValidation.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import { SvgCanvas } from '../../src/editor/canvas/SvgCanvas.tsx';

function diagonal() {
  const doc = createEmptyBuilding('quality', '');
  doc.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 4000, y_mm: 100 }, c: { x_mm: 4000, y_mm: 3000 } };
  const wall = { wall_type: 'exterior' as const, thickness_mm: 240, height_mm: 2800, material_type: 'brick' as const };
  doc.walls = { ab: { ...wall, start_vertex_id: 'a', end_vertex_id: 'b' }, bc: { ...wall, start_vertex_id: 'b', end_vertex_id: 'c' } };
  doc.floors[0].wall_ids = ['ab', 'bc'];
  return doc;
}

describe('DataQualityPanel', () => {
  it('blocks an invalid direction and allows switching back without changing geometry', () => {
    const doc = diagonal();
    doc.wall_elements.door = { host_wall_id: 'ab', element_type: 'door', offset_from_start_mm: 2000, width_mm: 900, height_mm: 2100, sill_height_mm: 0, status: 'valid' };
    useEditorStore.getState().loadBuilding(doc);
    render(<DataQualityPanel />);
    fireEvent.click(screen.getByRole('button', { name: '正交修复 ab' }));
    fireEvent.change(screen.getByLabelText('对齐方向'), { target: { value: 'vertical' } });
    expect(screen.getByRole('alert')).toHaveTextContent('构件超出有效范围');
    expect(screen.getByRole('button', { name: '应用修复' })).toBeDisabled();
    expect(useEditorStore.getState().buildingDocument).toBe(doc);
    fireEvent.change(screen.getByLabelText('对齐方向'), { target: { value: 'horizontal' } });
    expect(screen.getByRole('button', { name: '应用修复' })).not.toBeDisabled();
  });
  it('locates a live warning and previews, cancels, applies and undoes a repair', () => {
    const doc = diagonal(); useEditorStore.getState().loadBuilding(doc);
    render(<><SvgCanvas autoFitReference={false} /><DataQualityPanel /></>);
    fireEvent.click(screen.getByRole('button', { name: /墙 ab 非正交/ }));
    expect(useEditorStore.getState().selection).toEqual({ type: 'wall', id: 'ab' });
    fireEvent.click(screen.getAllByRole('button', { name: '正交修复 ab' })[0]);
    expect(screen.getByTestId('orthogonal-preview-after-bc')).toBeTruthy();
    expect(useEditorStore.getState().buildingDocument).toBe(doc);
    fireEvent.click(screen.getByRole('button', { name: '取消修复' }));
    expect(screen.queryByTestId('orthogonal-preview-after-bc')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '正交修复 ab' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '应用修复' }));
    expect(useEditorStore.getState().buildingDocument?.vertices.b.y_mm).toBe(0);
    expect(screen.queryByRole('button', { name: /墙 ab 非正交/ })).toBeNull();
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().buildingDocument?.vertices.b.y_mm).toBe(100);
    act(() => useEditorStore.getState().redo());
    expect(useEditorStore.getState().buildingDocument?.vertices.b.y_mm).toBe(0);
  });
  it('invalidates previews on document changes and prevents read-only repair', () => {
    const doc = diagonal(); useEditorStore.getState().loadBuilding(doc);
    render(<DataQualityPanel />);
    fireEvent.click(screen.getByRole('button', { name: '正交修复 ab' }));
    act(() => useEditorStore.getState().updateBuilding(current => ({ ...current })));
    expect(screen.getByRole('button', { name: '应用修复' })).toBeDisabled();
    act(() => useEditorStore.getState().loadBuilding({ ...doc, workflow: { ...doc.workflow, status: 'complete' } }));
    expect(screen.getAllByRole('button', { name: '正交修复 ab' })[0]).toBeDisabled();
  });
  it('shows bay and detected face counts together with the repair suggestion', () => {
    const document = createEmptyBuilding('quality', '');
    document.structured_validation = [
      createValidationIssue('BAY_FACE_COUNT_MISMATCH', 'building', undefined, {
        bay_count: 4,
        face_count: 3,
      }),
    ];
    useEditorStore.getState().loadBuilding(document);

    render(<DataQualityPanel />);

    expect(screen.getByText('开间数为 4，当前检索到 3 个室内面')).toBeTruthy();
    expect(screen.getByText('建议：请检查墙体是否全部闭合，或核对房屋信息中的开间数'))
      .toBeTruthy();
  });
});
