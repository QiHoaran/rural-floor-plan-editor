import { create } from 'zustand';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import type { Viewport } from '@/editor/canvas/Viewport.ts';

export type BuildingSaveStatus =
  | 'saved'
  | 'saving'
  | 'unsaved'
  | 'error';

export type EditorTool =
  | 'select'
  | 'exterior_wall'
  | 'interior_wall'
  | 'polyline_wall'
  | 'exterior_door'
  | 'exterior_window'
  | 'interior_door'
  | 'passage'
  | 'adjust_reference';

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
  buildingDocument: BuildingDocument | null;
  changeVersion: number;
  buildingSaveStatus: BuildingSaveStatus;
  buildingSaveError: string | null;
  tool: EditorTool;
  selection: { type: EditorEntityType; id: string } | null;
  snapMode: 'grid' | 'geometry' | 'none';
  directionMode: 'orthogonal' | 'diagonal45' | 'free';
  commandInput: string;
  viewport: Viewport;
  referenceImageLocked: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  loadBuilding: (document: BuildingDocument) => void;
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
  setSelection: (
    selection: { type: EditorEntityType; id: string } | null,
  ) => void;
  setSnapMode: (mode: 'grid' | 'geometry' | 'none') => void;
  setDirectionMode: (
    mode: 'orthogonal' | 'diagonal45' | 'free',
  ) => void;
  setCommandInput: (value: string) => void;
  setViewport: (viewport: Viewport) => void;
  setReferenceImageLocked: (locked: boolean) => void;
  beginBuildingSave: () => void;
  finishBuildingSave: (document: BuildingDocument) => void;
  failBuildingSave: (error: string) => void;
  closeBuilding: () => void;
}

const INITIAL_VIEWPORT: Viewport = {
  originXmm: -1000,
  originYmm: -1000,
  pixelsPerMm: 0.1,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  buildingDocument: null,
  changeVersion: 0,
  buildingSaveStatus: 'saved',
  buildingSaveError: null,
  tool: 'select',
  selection: null,
  snapMode: 'geometry',
  directionMode: 'orthogonal',
  commandInput: '',
  viewport: INITIAL_VIEWPORT,
  referenceImageLocked: true,
  undoStack: [],
  redoStack: [],

  loadBuilding: (document) =>
    set({
      buildingDocument: document,
      changeVersion: 0,
      buildingSaveStatus: 'saved',
      buildingSaveError: null,
      tool: 'select',
      selection: null,
      commandInput: '',
      undoStack: [],
      redoStack: [],
    }),

  updateBuilding: (update) => get().transact('编辑建筑', update),

  transact: (description, update) =>
    set((state) => {
      if (!state.buildingDocument) return state;
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

  setTool: (tool) =>
    set({
      tool,
      commandInput: '',
      selection: tool === 'select' ? get().selection : null,
    }),
  setSelection: (selection) => set({ selection }),
  setSnapMode: (snapMode) => set({ snapMode }),
  setDirectionMode: (directionMode) => set({ directionMode }),
  setCommandInput: (commandInput) => set({ commandInput }),
  setViewport: (viewport) => set({ viewport }),
  setReferenceImageLocked: (referenceImageLocked) =>
    set({ referenceImageLocked }),

  beginBuildingSave: () =>
    set({ buildingSaveStatus: 'saving', buildingSaveError: null }),

  finishBuildingSave: (document) =>
    set({
      buildingDocument: document,
      buildingSaveStatus: 'saved',
      buildingSaveError: null,
    }),

  failBuildingSave: (error) =>
    set({ buildingSaveStatus: 'error', buildingSaveError: error }),

  closeBuilding: () =>
    set({
      buildingDocument: null,
      changeVersion: 0,
      buildingSaveStatus: 'saved',
      buildingSaveError: null,
      tool: 'select',
      selection: null,
      commandInput: '',
      undoStack: [],
      redoStack: [],
    }),
}));
