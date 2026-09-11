import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadOnlyDialog } from '../../src/editor/dialogs/ReadOnlyDialog.tsx';
import { EditGuard } from '../../src/editor/panels/EditGuard.tsx';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { reopenProject } from '../../src/api/projectApi.ts';
vi.mock('../../src/api/projectApi.ts', () => ({ reopenProject: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  const doc = createEmptyBuilding('locked', ''); doc.workflow.status = 'complete';
  useEditorStore.getState().loadBuilding(doc);
  vi.mocked(reopenProject).mockReset();
});

it('blocks input and button edits before local changes, but permits viewing actions', () => {
  const edit = vi.fn(); const view = vi.fn();
  render(<><EditGuard><input aria-label="value" defaultValue="original" onChange={edit} /><button onClick={edit}>编辑</button><button data-readonly-view onClick={view}>查看</button></EditGuard><ReadOnlyDialog /></>);
  fireEvent.change(screen.getByLabelText('value'), { target: { value: 'changed' } });
  expect(edit).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '查看' }));
  expect(view).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  expect(edit).not.toHaveBeenCalled();
});

it('keeps the project locked on failure and unlocks only after a successful reopen', async () => {
  const doc = useEditorStore.getState().buildingDocument!;
  render(<ReadOnlyDialog />);
  act(() => { useEditorStore.getState().requestEdit(); });
  vi.mocked(reopenProject).mockRejectedValueOnce(new Error('网络失败'));
  fireEvent.click(screen.getByRole('button', { name: '重新打开并编辑' }));
  await screen.findByRole('alert');
  expect(useEditorStore.getState().buildingDocument).toBe(doc);
  vi.mocked(reopenProject).mockResolvedValueOnce({ ...doc, workflow: { status: 'draft' } });
  fireEvent.click(screen.getByRole('button', { name: '重新打开并编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(useEditorStore.getState().requestEdit()).toBe(true);
  expect(useEditorStore.getState().changeVersion).toBe(0);
});
