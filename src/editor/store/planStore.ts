// ============================================================
// Zustand Plan Store — 领域状态管理
// ============================================================

import { create } from 'zustand';
import type {
  PlanDocument,
  Vertex,
  Wall,
  Opening,
  Space,
  ToolType,
  SnapMode,
  SaveStatus,
  EntityType,
  ValidationIssue,
} from '@/editor/domain/planTypes.ts';
import type { TopologyActionResult } from '@/editor/domain/topologyManager.ts';
import {
  SCHEMA_VERSION,
  DEFAULT_GRID_SETTINGS,
  DEFAULT_PLAN_DEFAULTS,
  MAX_UNDO_STEPS,
  INITIAL_REVIEW_STATUS,
} from '@/editor/domain/constants.ts';

// ---- Command 快照接口 ----
export interface CommandSnapshot {
  description: string;
  patch: PlanDocument;
  timestamp: number;
}

// ---- Store 状态接口 ----
export interface PlanStoreState {
  // 领域数据
  planDocument: PlanDocument;

  // UI 状态
  selectedEntityId: string | null;
  selectedEntityType: EntityType;
  activeTool: ToolType;
  snapMode: SnapMode;
  currentWallThickness: number;
  displayGrid: boolean;

  // 状态
  validationIssues: ValidationIssue[];
  saveStatus: SaveStatus;
  saveError: string | null;

  // 撤销/重做
  undoStack: CommandSnapshot[];
  redoStack: CommandSnapshot[];

  // 悬浮状态
  hoveredWallId: string | null;

  // 操作
  setPlanDocument: (doc: PlanDocument) => void;
  setActiveTool: (tool: ToolType) => void;
  setSnapMode: (mode: SnapMode) => void;
  setCurrentWallThickness: (cm: number) => void;
  setDisplayGrid: (visible: boolean) => void;
  setSelectedEntity: (id: string | null, type: EntityType) => void;
  setHoveredWallId: (id: string | null) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setSaveError: (error: string | null) => void;

  // 领域操作
  addVertex: (id: string, vertex: Vertex) => void;
  updateVertex: (id: string, vertex: Partial<Vertex>) => void;
  removeVertex: (id: string) => void;

  addWall: (id: string, wall: Wall) => void;
  updateWall: (id: string, wall: Partial<Wall>) => void;
  removeWall: (id: string) => void;

  addOpening: (id: string, opening: Opening) => void;
  updateOpening: (id: string, opening: Partial<Opening>) => void;
  removeOpening: (id: string) => void;

  addSpace: (id: string, space: Space) => void;
  updateSpace: (id: string, space: Partial<Space>) => void;
  removeSpace: (id: string) => void;

  // 撤销/重做
  pushUndo: (description: string) => void;
  undo: () => void;
  redo: () => void;

  // 批量拓扑更新
  applyTopologyResult: (result: TopologyActionResult) => void;

  // 校验
  setValidationIssues: (issues: ValidationIssue[]) => void;
}

// ---- 初始 Plan Document ----
function createInitialPlanDocument(): PlanDocument {
  return {
    schema_version: SCHEMA_VERSION,
    plan_id: 'house_0001',
    image: {
      file_name: '',
      width_px: 0,
      height_px: 0,
      opacity: 0.65,
      rotation_deg: 0,
      flip_horizontal: false,
      flip_vertical: false,
    },
    coordinate_system: {
      type: 'local_cartesian',
      unit: 'cm',
      origin: 'bottom_left',
      y_axis: 'up',
      storage_precision_cm: 1,
      meters_per_pixel: null,
      north_angle_deg: null,
    },
    grid: { ...DEFAULT_GRID_SETTINGS },
    defaults: { ...DEFAULT_PLAN_DEFAULTS },
    vertices: {},
    walls: {},
    openings: {},
    spaces: {},
    relations: [],
    validation: { errors: [], warnings: [], infos: [] },
    review: { ...INITIAL_REVIEW_STATUS },
    metadata: {
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revision: 0,
    },
  };
}

// ---- 深拷贝辅助 ----
function deepClonePlan(doc: PlanDocument): PlanDocument {
  return JSON.parse(JSON.stringify(doc));
}

export const usePlanStore = create<PlanStoreState>((set) => ({
  // ---- 初始状态 ----
  planDocument: createInitialPlanDocument(),
  selectedEntityId: null,
  selectedEntityType: 'none',
  activeTool: 'select',
  snapMode: 'major',
  currentWallThickness: 24,
  displayGrid: true,
  validationIssues: [],
  saveStatus: 'saved',
  saveError: null,
  undoStack: [],
  redoStack: [],
  hoveredWallId: null,

  // ---- 通用设置 ----
  setPlanDocument: (doc) => set({ planDocument: deepClonePlan(doc) }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setSnapMode: (mode) => set({ snapMode: mode }),
  setCurrentWallThickness: (cm) => set({ currentWallThickness: cm }),
  setDisplayGrid: (visible) =>
    set((state) => ({
      displayGrid: visible,
      planDocument: {
        ...state.planDocument,
        grid: { ...state.planDocument.grid, visible },
      },
    })),
  setSelectedEntity: (id, type) =>
    set({ selectedEntityId: id, selectedEntityType: type }),
  setHoveredWallId: (id) => set({ hoveredWallId: id }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setSaveError: (error) => set({ saveError: error }),

  // ---- 顶点操作 ----
  addVertex: (id, vertex) =>
    set((state) => ({
      planDocument: {
        ...state.planDocument,
        vertices: { ...state.planDocument.vertices, [id]: vertex },
        metadata: {
          ...state.planDocument.metadata,
          updated_at: new Date().toISOString(),
          revision: state.planDocument.metadata.revision + 1,
        },
      },
    })),

  updateVertex: (id, partial) =>
    set((state) => {
      const existing = state.planDocument.vertices[id];
      if (!existing) return state;
      return {
        planDocument: {
          ...state.planDocument,
          vertices: {
            ...state.planDocument.vertices,
            [id]: { ...existing, ...partial },
          },
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
      };
    }),

  removeVertex: (id) =>
    set((state) => {
      const { [id]: _, ...remaining } = state.planDocument.vertices;
      return {
        planDocument: {
          ...state.planDocument,
          vertices: remaining,
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
      };
    }),

  // ---- 墙体操作 ----
  addWall: (id, wall) =>
    set((state) => ({
      planDocument: {
        ...state.planDocument,
        walls: { ...state.planDocument.walls, [id]: wall },
        metadata: {
          ...state.planDocument.metadata,
          updated_at: new Date().toISOString(),
          revision: state.planDocument.metadata.revision + 1,
        },
      },
      saveStatus: 'unsaved' as SaveStatus,
    })),

  updateWall: (id, partial) =>
    set((state) => {
      const existing = state.planDocument.walls[id];
      if (!existing) return state;
      return {
        planDocument: {
          ...state.planDocument,
          walls: {
            ...state.planDocument.walls,
            [id]: { ...existing, ...partial },
          },
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
        saveStatus: 'unsaved' as SaveStatus,
      };
    }),

  removeWall: (id) =>
    set((state) => {
      const { [id]: _, ...remaining } = state.planDocument.walls;
      return {
        planDocument: {
          ...state.planDocument,
          walls: remaining,
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
        saveStatus: 'unsaved' as SaveStatus,
        selectedEntityId:
          state.selectedEntityId === id ? null : state.selectedEntityId,
        selectedEntityType:
          state.selectedEntityId === id ? 'none' : state.selectedEntityType,
      };
    }),

  // ---- 门窗操作 ----
  addOpening: (id, opening) =>
    set((state) => ({
      planDocument: {
        ...state.planDocument,
        openings: { ...state.planDocument.openings, [id]: opening },
        metadata: {
          ...state.planDocument.metadata,
          updated_at: new Date().toISOString(),
          revision: state.planDocument.metadata.revision + 1,
        },
      },
      saveStatus: 'unsaved' as SaveStatus,
    })),

  updateOpening: (id, partial) =>
    set((state) => {
      const existing = state.planDocument.openings[id];
      if (!existing) return state;
      return {
        planDocument: {
          ...state.planDocument,
          openings: {
            ...state.planDocument.openings,
            [id]: { ...existing, ...partial },
          },
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
        saveStatus: 'unsaved' as SaveStatus,
      };
    }),

  removeOpening: (id) =>
    set((state) => {
      const { [id]: _, ...remaining } = state.planDocument.openings;
      return {
        planDocument: {
          ...state.planDocument,
          openings: remaining,
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
        saveStatus: 'unsaved' as SaveStatus,
      };
    }),

  // ---- 空间操作 ----
  addSpace: (id, space) =>
    set((state) => ({
      planDocument: {
        ...state.planDocument,
        spaces: { ...state.planDocument.spaces, [id]: space },
        metadata: {
          ...state.planDocument.metadata,
          updated_at: new Date().toISOString(),
          revision: state.planDocument.metadata.revision + 1,
        },
      },
    })),

  updateSpace: (id, partial) =>
    set((state) => {
      const existing = state.planDocument.spaces[id];
      if (!existing) return state;
      return {
        planDocument: {
          ...state.planDocument,
          spaces: {
            ...state.planDocument.spaces,
            [id]: { ...existing, ...partial },
          },
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
      };
    }),

  removeSpace: (id) =>
    set((state) => {
      const { [id]: _, ...remaining } = state.planDocument.spaces;
      return {
        planDocument: {
          ...state.planDocument,
          spaces: remaining,
          metadata: {
            ...state.planDocument.metadata,
            updated_at: new Date().toISOString(),
            revision: state.planDocument.metadata.revision + 1,
          },
        },
      };
    }),

  // ---- 撤销/重做 ----
  pushUndo: (description) =>
    set((state) => {
      const snapshot: CommandSnapshot = {
        description,
        patch: deepClonePlan(state.planDocument),
        timestamp: Date.now(),
      };
      const undoStack = [...state.undoStack, snapshot].slice(-MAX_UNDO_STEPS);
      return {
        undoStack,
        redoStack: [], // 新操作清空重做栈
      };
    }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      const redoSnapshot: CommandSnapshot = {
        description: 'undo',
        patch: deepClonePlan(state.planDocument),
        timestamp: Date.now(),
      };
      return {
        planDocument: deepClonePlan(prev.patch),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, redoSnapshot],
        saveStatus: 'unsaved' as SaveStatus,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      const undoSapshot: CommandSnapshot = {
        description: 'redo',
        patch: deepClonePlan(state.planDocument),
        timestamp: Date.now(),
      };
      return {
        planDocument: deepClonePlan(next.patch),
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, undoSapshot],
        saveStatus: 'unsaved' as SaveStatus,
      };
    }),

  // ---- 校验 ----
  setValidationIssues: (issues) =>
    set((state) => ({
      validationIssues: issues,
      planDocument: {
        ...state.planDocument,
        validation: {
          errors: issues.filter((i) => i.level === 'error'),
          warnings: issues.filter((i) => i.level === 'warning'),
          infos: issues.filter((i) => i.level === 'info'),
        },
      },
    })),

  // ---- 批量拓扑更新 ----
  applyTopologyResult: (result) =>
    set((state) => {
      const doc = deepClonePlan(state.planDocument);

      // 添加新顶点
      for (const v of result.newVertices) {
        doc.vertices[v.id] = { x_cm: v.x_cm, y_cm: v.y_cm };
      }

      // 删除旧墙
      for (const wId of result.wallsToRemove) {
        delete doc.walls[wId];
      }

      // 添加新墙
      for (const w of result.newWalls) {
        doc.walls[w.id] = {
          start_vertex_id: w.start_vertex_id,
          end_vertex_id: w.end_vertex_id,
          wall_type: w.wall_type as any,
          thickness_cm: w.thickness_cm,
          height_cm: w.height_cm,
          material_type: w.material_type as any,
          review_status: w.review_status as any,
        };
      }

      // 更新门窗宿主
      for (const u of result.openingUpdates) {
        const op = doc.openings[u.openingId];
        if (op) {
          op.host_wall_id = u.newHostWallId;
          op.offset_from_start_cm = u.newOffset;
        }
      }

      doc.metadata.revision += 1;
      doc.metadata.updated_at = new Date().toISOString();

      return {
        planDocument: doc,
        saveStatus: 'unsaved' as SaveStatus,
      };
    }),
}));
