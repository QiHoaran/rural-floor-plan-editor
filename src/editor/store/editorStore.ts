import { create } from 'zustand';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import {
  DEFAULT_VIEW_PIXELS_PER_MM,
  type Viewport,
} from '@/editor/canvas/Viewport.ts';
import { computeBuildingStatistics } from '@/editor/domain/buildingStatistics.ts';
import { validateBuildingDocumentFull } from '@/editor/domain/buildingValidation.ts';

export type BuildingSaveStatus =
  | 'saved'
  | 'saving'
  | 'unsaved'
  | 'error'
  | 'conflict';

export type EditorTool =
  | 'select'
  | 'exterior_wall'
  | 'interior_wall'
  | 'polyline_wall'
  | 'exterior_door'
  | 'exterior_window'
  | 'interior_door'
  | 'passage'
  | 'adjust_reference'
  | 'room_label_brush'
  | 'reference_calibration';

export type EditorEntityType =
  | 'wall'
  | 'wall_element'
  | 'face'
  | 'vertex'
  | 'outside_region';

interface HistoryEntry {
  description: string;
  document: BuildingDocument;
}

export interface EditorStore {
  showVertices: boolean;
  setShowVertices: (show: boolean) => void;
  editingSuspended: boolean;
  setEditingSuspended: (suspended: boolean) => void;
  readOnlyPromptOpen: boolean;
  setReadOnlyPromptOpen: (open: boolean) => void;
  requestEdit: () => boolean;
  loadVersion: number;
  catalogSession: number;
  buildingDocument: BuildingDocument | null;
  changeVersion: number;
  buildingSaveStatus: BuildingSaveStatus;
  buildingSaveError: string | null;
  tool: EditorTool;
  /** 房间标注刷当前选中的功能代码 */
  brushFunctionCode: string;
  selection: { type: EditorEntityType; id: string } | null;
  /** 多选（用于批量标注） */
  multiSelection: Array<{ type: EditorEntityType; id: string }>;
  snapMode: 'grid' | 'geometry' | 'none';
  directionMode: 'orthogonal' | 'diagonal45' | 'free';
  commandInput: string;
  viewport: Viewport;
  referenceImageLocked: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  loadBuilding: (document: BuildingDocument, options?: { preserveCatalogSession?: boolean }) => void;
  updateBuilding: (
    update: (document: BuildingDocument) => BuildingDocument,
  ) => void;
  transact: (
    description: string,
    update: (document: BuildingDocument) => BuildingDocument,
  ) => void;
  undo: () => void;
  redo: () => void;
  setTool: (tool: EditorTool) => void;
  setBrushFunctionCode: (code: string) => void;
  setSelection: (
    selection: { type: EditorEntityType; id: string } | null,
  ) => void;
  toggleMultiSelection: (
    selection: { type: EditorEntityType; id: string },
  ) => void;
  clearMultiSelection: () => void;
  setMultiSelection: (
    selections: Array<{ type: EditorEntityType; id: string }>,
  ) => void;
  setSnapMode: (mode: 'grid' | 'geometry' | 'none') => void;
  setDirectionMode: (
    mode: 'orthogonal' | 'diagonal45' | 'free',
  ) => void;
  setCommandInput: (value: string) => void;
  setViewport: (viewport: Viewport) => void;
  setReferenceImageLocked: (locked: boolean) => void;
  beginBuildingSave: () => void;
  finishBuildingSave: (
    document: BuildingDocument,
    savedChangeVersion?: number,
  ) => BuildingDocument | null;
  failBuildingSave: (error: string) => void;
  conflictSave: (error: string) => void;
  closeBuilding: () => void;
  computeStats: () => void;
}

const INITIAL_VIEWPORT: Viewport = {
  originXmm: -1000,
  originYmm: -1000,
  pixelsPerMm: DEFAULT_VIEW_PIXELS_PER_MM,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  showVertices: true,
  setShowVertices: (showVertices) => set({ showVertices }),
  editingSuspended: false,
  setEditingSuspended: (editingSuspended) => set({ editingSuspended, ...(editingSuspended ? { tool: 'select' as const, commandInput: '' } : {}) }),
  readOnlyPromptOpen: false,
  setReadOnlyPromptOpen: (readOnlyPromptOpen) => set({ readOnlyPromptOpen }),
  requestEdit: () => {
    const state = get();
    if (isCompleted(state.buildingDocument)) {
      set({ readOnlyPromptOpen: true });
      return false;
    }
    return !state.editingSuspended;
  },
  loadVersion: 0,
  catalogSession: 0,
  buildingDocument: null,
  changeVersion: 0,
  buildingSaveStatus: 'saved',
  buildingSaveError: null,
  tool: 'select',
  brushFunctionCode: 'living_room',
  selection: null,
  multiSelection: [],
  snapMode: 'geometry',
  directionMode: 'orthogonal',
  commandInput: '',
  viewport: INITIAL_VIEWPORT,
  referenceImageLocked: true,
  undoStack: [],
  redoStack: [],

  loadBuilding: (document, options) =>
    set((state) => ({
      loadVersion: state.loadVersion + 1,
      catalogSession: state.catalogSession + (options?.preserveCatalogSession ? 0 : 1),
      editingSuspended: false,
      readOnlyPromptOpen: false,
      buildingDocument: document,
      changeVersion: 0,
      buildingSaveStatus: 'saved',
      buildingSaveError: null,
      tool: 'select',
      selection: null,
      multiSelection: [],
      commandInput: '',
      viewport:
        state.buildingDocument?.building_id === document.building_id
          ? state.viewport
          : { ...INITIAL_VIEWPORT },
      undoStack: [],
      redoStack: [],
    })),

  updateBuilding: (update) => get().transact('编辑建筑', update),

  transact: (description, update) =>
    set((state) => {
      if (!state.buildingDocument) return state;
      if (isCompleted(state.buildingDocument)) return { readOnlyPromptOpen: true };
      if (state.editingSuspended) return state;
      const previous = state.buildingDocument;
      const next = update(previous);
      if (next === previous) return state;

      return {
        buildingDocument: next,
        changeVersion: state.changeVersion + 1,
        buildingSaveStatus: 'unsaved',
        buildingSaveError: null,
        undoStack: [
          ...state.undoStack.slice(-99),
          { description, document: previous },
        ],
        redoStack: [],
      };
    }),

  undo: () =>
    set((state) => {
      if (isCompleted(state.buildingDocument)) return { readOnlyPromptOpen: true };
      if (state.editingSuspended) return state;
      if (!state.buildingDocument || state.undoStack.length === 0) {
        return state;
      }
      const entry = state.undoStack[state.undoStack.length - 1];
      return {
        buildingDocument: entry.document,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [
          ...state.redoStack,
          { description: entry.description, document: state.buildingDocument },
        ],
        changeVersion: state.changeVersion + 1,
        buildingSaveStatus: 'unsaved',
        buildingSaveError: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (isCompleted(state.buildingDocument)) return { readOnlyPromptOpen: true };
      if (state.editingSuspended) return state;
      if (!state.buildingDocument || state.redoStack.length === 0) {
        return state;
      }
      const entry = state.redoStack[state.redoStack.length - 1];
      return {
        buildingDocument: entry.document,
        undoStack: [
          ...state.undoStack,
          { description: entry.description, document: state.buildingDocument },
        ],
        redoStack: state.redoStack.slice(0, -1),
        changeVersion: state.changeVersion + 1,
        buildingSaveStatus: 'unsaved',
        buildingSaveError: null,
      };
    }),

  setTool: (tool) => {
    if (tool !== 'select' && !get().requestEdit()) return;
    set({
      tool,
      commandInput: '',
      selection: tool === 'select' ? get().selection : null,
    });
  },
  setBrushFunctionCode: (brushFunctionCode) => set({ brushFunctionCode }),
  setSelection: (selection) =>
    set({ selection, multiSelection: [] }),
  toggleMultiSelection: (sel) =>
    set((state) => {
      const exists = state.multiSelection.some(
        (s) => s.type === sel.type && s.id === sel.id,
      );
      if (exists) {
        return {
          multiSelection: state.multiSelection.filter(
            (s) => !(s.type === sel.type && s.id === sel.id),
          ),
        };
      }
      return {
        multiSelection: [...state.multiSelection, sel],
      };
    }),
  clearMultiSelection: () =>
    set({ multiSelection: [] }),
  setMultiSelection: (selections) =>
    set({ multiSelection: selections }),
  setSnapMode: (snapMode) => set({ snapMode }),
  setDirectionMode: (directionMode) => set({ directionMode }),
  setCommandInput: (commandInput) => set({ commandInput }),
  setViewport: (viewport) => set({ viewport }),
  setReferenceImageLocked: (referenceImageLocked) =>
    set({ referenceImageLocked }),

  beginBuildingSave: () =>
    set({ buildingSaveStatus: 'saving', buildingSaveError: null }),

  finishBuildingSave: (document, savedChangeVersion) => {
    let reconciled: BuildingDocument | null = null;
    set((state) => {
      if (!state.buildingDocument) return state;
      if (document.building_id !== state.buildingDocument.building_id ||
        (isCompleted(state.buildingDocument) && !isCompleted(document))) {
        reconciled = state.buildingDocument;
        return state;
      }
      const rebase = (entry: HistoryEntry): HistoryEntry => ({
        ...entry,
        document: withServerMetadata(entry.document, document.metadata),
      });
      if (
        savedChangeVersion === undefined ||
        state.changeVersion === savedChangeVersion
      ) {
        reconciled = document;
        return {
          buildingDocument: document,
          buildingSaveStatus: 'saved',
          buildingSaveError: null,
          undoStack: state.undoStack.map(rebase),
          redoStack: state.redoStack.map(rebase),
        };
      }
      reconciled = withServerMetadata(
        state.buildingDocument,
        document.metadata,
      );
      return {
        buildingDocument: reconciled,
        buildingSaveStatus: 'unsaved',
        buildingSaveError: null,
        undoStack: state.undoStack.map(rebase),
        redoStack: state.redoStack.map(rebase),
      };
    });
    return reconciled;
  },

  failBuildingSave: (error) =>
    set({ buildingSaveStatus: 'error', buildingSaveError: error }),

  conflictSave: (error) =>
    set({ buildingSaveStatus: 'conflict', buildingSaveError: error }),

  closeBuilding: () =>
    set((state) => ({
      loadVersion: state.loadVersion + 1,
      catalogSession: state.catalogSession + 1,
      editingSuspended: false,
      readOnlyPromptOpen: false,
      buildingDocument: null,
      changeVersion: 0,
      buildingSaveStatus: 'saved',
      buildingSaveError: null,
      tool: 'select',
      selection: null,
      multiSelection: [],
      commandInput: '',
      undoStack: [],
      redoStack: [],
    })),

  // 惰性计算统计和校验（不在 transact 中同步执行，避免破坏事务引用）
  computeStats: () => {
    const doc = get().buildingDocument;
    if (!doc || isCompleted(doc) || get().editingSuspended) return;
    set({
      buildingDocument: {
        ...doc,
        statistics: computeBuildingStatistics(doc),
        structured_validation: validateBuildingDocumentFull(doc),
      },
    });
  },
}));

export function isCompleted(document: BuildingDocument | null): boolean {
  return document?.workflow.status === 'complete' || document?.metadata.status === 'complete';
}

function withServerMetadata(
  document: BuildingDocument,
  metadata: BuildingDocument['metadata'],
): BuildingDocument {
  return {
    ...document,
    metadata: {
      ...document.metadata,
      status: metadata.status,
      updated_at: metadata.updated_at,
      revision: metadata.revision,
    },
  };
}
