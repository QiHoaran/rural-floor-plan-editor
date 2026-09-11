import { beforeEach, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';

beforeEach(() => useEditorStore.getState().loadBuilding(createEmptyBuilding('locked', '')));

it('blocks all document mutations and history without running updates', () => {
  const doc = useEditorStore.getState().buildingDocument!;
  doc.workflow.status = 'complete';
  const update = vi.fn((value) => ({ ...value }));
  const before = useEditorStore.getState();
  before.transact('change', update);
  before.updateBuilding(update);
  before.undo(); before.redo(); before.setTool('interior_wall');
  const after = useEditorStore.getState();
  expect(update).not.toHaveBeenCalled();
  expect(after.buildingDocument).toBe(doc);
  expect(after.changeVersion).toBe(before.changeVersion);
  expect(after.undoStack).toBe(before.undoStack);
  expect(after.tool).toBe('select');
  expect(after.readOnlyPromptOpen).toBe(true);
});

it('pauses editing while completing but keeps viewing available', () => {
  const store = useEditorStore.getState();
  store.setEditingSuspended(true);
  expect(store.requestEdit()).toBe(false);
  store.setShowVertices(false);
  store.setSelection({ type: 'wall', id: 'w' });
  expect(useEditorStore.getState().showVertices).toBe(false);
  expect(useEditorStore.getState().selection?.id).toBe('w');
  store.setEditingSuspended(false);
  expect(store.requestEdit()).toBe(true);
});

it('ignores late saves that would reopen a completed project or replace another project', () => {
  const draft = useEditorStore.getState().buildingDocument!;
  const completed = { ...draft, workflow: { status: 'complete' as const } };
  useEditorStore.getState().loadBuilding(completed);
  useEditorStore.getState().finishBuildingSave(draft);
  expect(useEditorStore.getState().buildingDocument).toBe(completed);
  const another = createEmptyBuilding('another', '');
  useEditorStore.getState().loadBuilding(another);
  useEditorStore.getState().finishBuildingSave(draft);
  expect(useEditorStore.getState().buildingDocument).toBe(another);
});
