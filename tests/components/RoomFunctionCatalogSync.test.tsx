import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRoomFunctionTemplates } from '../../src/editor/hooks/useRoomFunctionTemplates.ts';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import { useEditorStore } from '../../src/editor/store/editorStore.ts';
import * as api from '../../src/api/projectApi.ts';
vi.mock('../../src/api/projectApi.ts', () => ({
  listRoomFunctionTemplates: vi.fn(), createRoomFunctionTemplate: vi.fn(), updateRoomFunctionTemplate: vi.fn(), deleteRoomFunctionTemplate: vi.fn(),
}));
afterEach(cleanup);
const canonical = { code: 'global', name: 'Study', color: '#aabbcc' };
function documentWithFunction() {
  const doc = createEmptyBuilding('catalog', '');
  doc.custom_function_types = [{ code: 'old', name: ' Study ', color: '#000000' }, { code: 'unused', name: 'Unused', color: '#ffffff' }];
  doc.faces.room = { boundary_vertex_ids: [], area_mm2: 0, function_code: 'old', display_name: 'Study', color: '#000000', local_name: '书房' };
  return doc;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listRoomFunctionTemplates).mockResolvedValue([canonical]);
  vi.mocked(api.createRoomFunctionTemplate).mockResolvedValue(canonical);
  vi.mocked(api.deleteRoomFunctionTemplate).mockResolvedValue();
  useEditorStore.getState().loadBuilding(documentWithFunction());
});

it('shares deletion immediately and restores used functions only when reopening', async () => {
  const first = renderHook(useRoomFunctionTemplates);
  const second = renderHook(useRoomFunctionTemplates);
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(api.listRoomFunctionTemplates).toHaveBeenCalledTimes(1);
  expect(useEditorStore.getState().buildingDocument!.faces.room.color).toBe(canonical.color);
  await act(async () => { await first.result.current.deleteTemplate(canonical.code); });
  expect(second.result.current.templates).toEqual([]);
  expect(useEditorStore.getState().buildingDocument!.faces.room.display_name).toBe('Study');
  expect(api.createRoomFunctionTemplate).not.toHaveBeenCalled();
  vi.mocked(api.listRoomFunctionTemplates).mockResolvedValue([]);
  act(() => useEditorStore.getState().loadBuilding(useEditorStore.getState().buildingDocument!));
  await waitFor(() => expect(second.result.current.templates).toEqual([canonical]));
  expect(api.createRoomFunctionTemplate).toHaveBeenCalledExactlyOnceWith({ name: 'Study', color: '#aabbcc' });
});

it('keeps completed documents identical and reconciles once after reopening', async () => {
  const doc = documentWithFunction(); doc.workflow.status = 'complete';
  useEditorStore.getState().loadBuilding(doc);
  const hook = renderHook(useRoomFunctionTemplates);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(useEditorStore.getState().buildingDocument).toBe(doc);
  expect(useEditorStore.getState().changeVersion).toBe(0);
  act(() => useEditorStore.getState().loadBuilding({ ...doc, workflow: { status: 'draft' } }));
  await waitFor(() => expect(useEditorStore.getState().buildingDocument!.faces.room.function_code).toBe('global'));
  expect(useEditorStore.getState().undoStack).toHaveLength(1);
  act(() => useEditorStore.getState().undo());
  expect(useEditorStore.getState().buildingDocument!.faces.room.function_code).toBe('old');
  // Undo does not immediately re-trigger reconciliation.
  expect(useEditorStore.getState().changeVersion).toBe(2);
});

it('promotes and demotes without changing room properties', async () => {
  const hook = renderHook(useRoomFunctionTemplates);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const doc = useEditorStore.getState().buildingDocument;
  vi.mocked(api.updateRoomFunctionTemplate).mockResolvedValue({ ...canonical, is_builtin: true });
  await act(async () => { await hook.result.current.updateTemplate(canonical.code, canonical.name, canonical.color, true); });
  expect(hook.result.current.templates[0].is_builtin).toBe(true);
  expect(useEditorStore.getState().buildingDocument).toBe(doc);
  vi.mocked(api.updateRoomFunctionTemplate).mockResolvedValue({ ...canonical, is_builtin: false });
  await act(async () => { await hook.result.current.updateTemplate(canonical.code, canonical.name, canonical.color, false); });
  expect(hook.result.current.templates[0].is_builtin).toBe(false);
  expect(useEditorStore.getState().buildingDocument).toBe(doc);
});

it('does not restore deleted templates on workflow responses within the same open session', async () => {
  const hook = renderHook(useRoomFunctionTemplates);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => { await hook.result.current.deleteTemplate(canonical.code); });
  act(() => {
    const doc = useEditorStore.getState().buildingDocument!;
    useEditorStore.getState().loadBuilding({ ...doc, workflow: { status: 'reviewed' } }, { preserveCatalogSession: true });
  });
  expect(hook.result.current.templates).toEqual([]);
  expect(api.listRoomFunctionTemplates).toHaveBeenCalledTimes(1);
  expect(api.createRoomFunctionTemplate).not.toHaveBeenCalled();
});
