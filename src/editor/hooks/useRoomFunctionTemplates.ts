import { useEffect } from 'react';
import { create } from 'zustand';
import { createRoomFunctionTemplate, deleteRoomFunctionTemplate, listRoomFunctionTemplates, updateRoomFunctionTemplate } from '@/api/projectApi.ts';
import { useEditorStore, isCompleted } from '../store/editorStore.ts';
import { CORE_ROOM_FUNCTION_PRESETS, normalizeFunctionName, reconcileRoomFunctions, roomFunctionCatalog, usedRoomFunctions, type RoomFunctionTemplate } from '../domain/roomFunctionTemplates.ts';

interface CatalogState {
  templates: RoomFunctionTemplate[];
  loading: boolean;
  error: string;
  session: number;
}
export const useRoomFunctionCatalog = create<CatalogState>(() => ({ templates: [], loading: true, error: '', session: -1 }));
let pending: Promise<void> | null = null;

function applyCatalog(aliases?: ReadonlyMap<string, string>) {
  const editor = useEditorStore.getState();
  if (!editor.buildingDocument || isCompleted(editor.buildingDocument) || editor.editingSuspended) return;
  const catalog = roomFunctionCatalog(useRoomFunctionCatalog.getState().templates);
  editor.transact('合并同名房间功能', (document) => reconcileRoomFunctions(document, catalog, aliases));
  const brush = aliases?.get(editor.brushFunctionCode);
  if (brush) editor.setBrushFunctionCode(brush);
}

async function ensureCatalog(session: number): Promise<void> {
  if (useRoomFunctionCatalog.getState().session === session) return pending ?? Promise.resolve();
  useRoomFunctionCatalog.setState({ session, templates: [], loading: true, error: '' });
  const active = () => useEditorStore.getState().catalogSession === session && useRoomFunctionCatalog.getState().session === session;
  pending = (async () => {
    try {
      let templates = await listRoomFunctionTemplates();
      if (!active()) return;
      const document = useEditorStore.getState().buildingDocument;
      if (document) {
        for (const used of usedRoomFunctions(document)) {
          const catalog = roomFunctionCatalog(templates);
          if (catalog.some((item) => item.code === used.code || normalizeFunctionName(item.name) === normalizeFunctionName(used.name))) continue;
          const restored = await createRoomFunctionTemplate({ name: used.name, color: used.color });
          if (!active()) return;
          templates = [...templates, restored];
        }
      }
      useRoomFunctionCatalog.setState({ templates, loading: false });
      applyCatalog();
    } catch (reason) {
      if (active()) useRoomFunctionCatalog.setState({ loading: false, error: reason instanceof Error ? reason.message : '无法读取房间模板' });
    }
  })();
  return pending;
}

function requireEditable() {
  if (!useEditorStore.getState().requestEdit()) throw new Error('项目当前不可编辑');
}

export function useRoomFunctionCatalogSync() {
  const session = useEditorStore((state) => state.catalogSession);
  useEffect(() => { void ensureCatalog(session); }, [session]);
}

export function useRoomFunctionTemplates() {
  useRoomFunctionCatalogSync();
  const state = useRoomFunctionCatalog();
  const setError = (error: string) => useRoomFunctionCatalog.setState({ error });
  const createTemplate = async (name: string, color: string) => {
    requireEditable();
    const version = useEditorStore.getState().loadVersion;
    const created = await createRoomFunctionTemplate({ name, color });
    if (useEditorStore.getState().loadVersion !== version) throw new Error('项目已切换，请重新读取房间功能');
    useRoomFunctionCatalog.setState((current) => ({ templates: upsert(current.templates, created) }));
    applyCatalog();
    return created;
  };
  const updateTemplate = async (code: string, name: string, color: string, is_builtin?: boolean) => {
    requireEditable();
    const version = useEditorStore.getState().loadVersion;
    const updated = await updateRoomFunctionTemplate(code, { name, color, ...(is_builtin === undefined ? {} : { is_builtin }) });
    if (useEditorStore.getState().loadVersion !== version) throw new Error('项目已切换，请重新读取房间功能');
    useRoomFunctionCatalog.setState((current) => ({ templates: upsert(current.templates.filter((item) => item.code !== code), updated) }));
    if (is_builtin === undefined) applyCatalog(new Map([[code, updated.code]]));
    return updated;
  };
  const deleteTemplate = async (code: string) => {
    requireEditable();
    const version = useEditorStore.getState().loadVersion;
    await deleteRoomFunctionTemplate(code);
    if (useEditorStore.getState().loadVersion !== version) throw new Error('项目已切换，请重新读取房间功能');
    useRoomFunctionCatalog.setState((current) => ({ templates: current.templates.filter((item) => item.code !== code) }));
    // Recovery only runs on the next loadBuilding session.
  };
  return { ...state, setError, createTemplate, updateTemplate, deleteTemplate };
}

function upsert(templates: RoomFunctionTemplate[], item: RoomFunctionTemplate): RoomFunctionTemplate[] {
  if (CORE_ROOM_FUNCTION_PRESETS.some((preset) => preset.code === item.code)) return templates;
  return [...templates.filter((existing) => existing.code !== item.code && normalizeFunctionName(existing.name) !== normalizeFunctionName(item.name)), item];
}
