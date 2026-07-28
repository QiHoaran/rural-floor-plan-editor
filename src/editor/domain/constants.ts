// ============================================================
// 集中配置常量 — 禁止散落的魔法数字
// v2.1.0: 统一毫米单位，保留 cm 常量供迁移使用
// ============================================================

import type { GridSettings, PlanDefaults, SnapMode } from './planTypes.ts';

// ---- Schema ----
export const SCHEMA_VERSION = '0.2.0'; // 旧 PlanDocument schema
export const CURRENT_SCHEMA_VERSION = '2.1.0'; // 当前 BuildingDocument schema

// ---- 网格（cm，仅用于 PlanDocument 兼容） ----
export const MAJOR_GRID_STEP_CM = 24;
export const MINOR_GRID_STEP_CM = 6;
export const FINE_STEP_CM = 1;

/** 加强网格（每5个主格 = 120 cm） */
export const SUPER_GRID_STEP_CM = 120;

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  major_step_cm: MAJOR_GRID_STEP_CM,
  minor_step_cm: MINOR_GRID_STEP_CM,
  visible: true,
  snap_enabled: true,
  default_snap_mode: 'major',
};

// ---- 墙体（cm，仅用于 PlanDocument 兼容） ----
export const DEFAULT_WALL_THICKNESS_CM = 24;
export const DEFAULT_EXTERIOR_WALL_THICKNESS_CM = 37;
export const DEFAULT_INTERIOR_WALL_THICKNESS_CM = 24;
export const DEFAULT_WALL_HEIGHT_CM = 300;

export const WALL_THICKNESS_PRESETS = [12, 18, 24, 37, 49] as const;

export const MIN_WALL_LENGTH_CM = 10;

// ---- 墙体（mm，BuildingDocument 使用） ----
export const DEFAULT_WALL_THICKNESS_MM = 240;
export const DEFAULT_EXTERIOR_WALL_THICKNESS_MM = 370;
export const DEFAULT_INTERIOR_WALL_THICKNESS_MM = 240;
export const DEFAULT_WALL_HEIGHT_MM = 3000;

export const WALL_THICKNESS_PRESETS_MM = [120, 180, 240, 370, 490] as const;
export const MIN_WALL_LENGTH_MM = 100;

// ---- 门窗（cm，仅用于 PlanDocument 兼容） ----
export const DEFAULT_DOOR_WIDTH_CM = 90;
export const DEFAULT_WINDOW_WIDTH_CM = 120;

export const DOOR_WIDTH_PRESETS = [70, 80, 90, 100, 120, 150] as const;
export const WINDOW_WIDTH_PRESETS = [60, 90, 120, 150, 180] as const;

export const DEFAULT_DOOR_HEIGHT_CM = 210;
export const DEFAULT_WINDOW_HEIGHT_CM = 150;
export const DEFAULT_SILL_HEIGHT_CM = 90;

// ---- 门窗（mm，BuildingDocument 使用） ----
export const DEFAULT_DOOR_WIDTH_MM = 900;
export const DEFAULT_WINDOW_WIDTH_MM = 1200;
export const DEFAULT_DOOR_HEIGHT_MM = 2100;
export const DEFAULT_WINDOW_HEIGHT_MM = 1500;
export const DEFAULT_SILL_HEIGHT_MM = 900;
export const DEFAULT_PASSAGE_WIDTH_MM = 1000;
export const DEFAULT_PASSAGE_HEIGHT_MM = 2100;

// ---- 默认值集合（PlanDocument 兼容） ----
export const DEFAULT_PLAN_DEFAULTS: PlanDefaults = {
  wall_thickness_cm: DEFAULT_WALL_THICKNESS_CM,
  exterior_wall_thickness_cm: DEFAULT_EXTERIOR_WALL_THICKNESS_CM,
  interior_wall_thickness_cm: DEFAULT_INTERIOR_WALL_THICKNESS_CM,
  wall_height_cm: DEFAULT_WALL_HEIGHT_CM,
  door_width_cm: DEFAULT_DOOR_WIDTH_CM,
  window_width_cm: DEFAULT_WINDOW_WIDTH_CM,
};

// ---- 吸附容差（cm） ----
export const SNAP_TOLERANCE: Record<SnapMode, number> = {
  major: 12,
  minor: 3,
  fine: 1,
  none: 0,
};

export const VERTEX_SNAP_DISTANCE_CM = 12;
export const WALL_HOVER_DISTANCE_CM = 18;

// ---- 网格缩放级别 ----
export const ZOOM_SUPER_GRID_ONLY = 0;
export const ZOOM_MAJOR_GRID = 2;
export const ZOOM_MINOR_GRID = 4;
export const ZOOM_FINE_GRID = 5;

// ---- 地图 ----
export const MAP_MIN_ZOOM = -2;
export const MAP_MAX_ZOOM = 8;
export const MAP_ZOOM = 0;

// ---- 撤销历史 ----
export const MAX_UNDO_STEPS = 100;

// ---- 自动保存 ----
export const AUTO_SAVE_DELAY_MS = 800;

// ---- IndexedDB ----
export const DB_NAME = 'rural-floor-plan-editor';
export const DB_VERSION = 1;
export const DB_STORE_NAME = 'projects';

// ---- 房间（cm，PlanDocument 兼容） ----
export const MIN_ROOM_AREA_CM2 = 5000; // 0.5 m²
export const MAX_ROOM_ASPECT_RATIO = 20;

// ---- 房间（mm，BuildingDocument 使用） ----
export const MIN_ROOM_AREA_MM2 = 500_000; // 0.5 m²

// ---- 审核 ----
export const INITIAL_REVIEW_STATUS = {
  status: 'draft' as const,
  reviewer: null,
  reviewed_at: null,
};

// ---- 数字键切换墙厚映射 ----
export const NUM_KEY_WALL_THICKNESS: Record<string, number> = {
  '1': 12,
  '2': 18,
  '3': 24,
  '4': 37,
  '5': 49,
};

// ---- 颜色 ----
export const COLORS = {
  EXTERIOR_WALL: '#2563eb',
  INTERIOR_WALL: '#64748b',
  PARTITION_WALL: '#94a3b8',
  WALL_SELECTED: '#f59e0b',
  WALL_HOVER: '#3b82f6',
  WALL_FACE: 'rgba(100, 116, 139, 0.15)',
  DOOR: '#8b5cf6',
  WINDOW: '#06b6d4',
  ROOM_LABEL: '#1e293b',
  ROOM_BORDER: 'rgba(0, 0, 0, 0.08)',
  GRID_MAJOR: 'rgba(0, 0, 0, 0.12)',
  GRID_MINOR: 'rgba(0, 0, 0, 0.05)',
  GRID_SUPER: 'rgba(0, 0, 0, 0.2)',
  ERROR: '#ef4444',
  WARNING: '#f59e0b',
  INFO: '#3b82f6',
  VERTEX: '#ef4444',
  VERTEX_SNAP_HINT: 'rgba(239, 68, 68, 0.4)',
  NORTH_ARROW: '#e53e3e',
  VALIDATION_ERROR_BG: 'rgba(239, 68, 68, 0.15)',
  VALIDATION_WARNING_BG: 'rgba(245, 158, 11, 0.15)',
  VALIDATION_INFO_BG: 'rgba(59, 130, 246, 0.10)',
};

/** 墙体类型对应的显示颜色 */
export const WALL_TYPE_COLORS: Record<string, string> = {
  exterior: COLORS.EXTERIOR_WALL,
  interior: COLORS.INTERIOR_WALL,
  partition: COLORS.PARTITION_WALL,
  unknown: COLORS.INTERIOR_WALL,
};

// ---- 乡村住宅房间功能字典 ----
// 稳定代码用于存储，中文名称仅用于显示
export interface RoomFunctionEntry {
  code: string;
  name: string;
  color: string;
  /** 是否为居住空间（heated/occupied 默认值参考） */
  residential: boolean;
}

export const ROOM_FUNCTION_DICTIONARY: readonly RoomFunctionEntry[] = [
  { code: 'living_room', name: '客厅', color: '#f2c879', residential: true },
  { code: 'bedroom', name: '卧室', color: '#c9b8e8', residential: true },
  { code: 'kitchen', name: '厨房', color: '#ef9a74', residential: true },
  { code: 'dining_room', name: '餐厅', color: '#f4d58d', residential: true },
  { code: 'toilet', name: '卫生间', color: '#89c8d0', residential: false },
  { code: 'bathroom', name: '洗浴间', color: '#89c8d0', residential: false },
  { code: 'storage', name: '储藏室', color: '#b7a58c', residential: false },
  { code: 'corridor', name: '走廊', color: '#d5d9df', residential: false },
  { code: 'staircase', name: '楼梯间', color: '#c4b5a5', residential: false },
  { code: 'utility_room', name: '杂物间', color: '#9eb58f', residential: false },
  { code: 'livestock_room', name: '牲畜用房', color: '#c49a6c', residential: false },
  { code: 'agricultural', name: '农业生产空间', color: '#8fbc8f', residential: false },
  { code: 'garage', name: '车库', color: '#a0a0a0', residential: false },
  { code: 'courtyard', name: '院落', color: '#a8d5a2', residential: false },
  { code: 'other', name: '其他', color: '#cbd5e1', residential: false },
  { code: 'unknown', name: '未标注', color: '#e2e8f0', residential: false },
] as const;

/** 根据功能代码获取显示名称 */
export function getRoomFunctionName(code: string | null): string {
  if (!code) return '未标注';
  const entry = ROOM_FUNCTION_DICTIONARY.find((e) => e.code === code);
  return entry?.name ?? code;
}

/** 根据功能代码获取显示颜色 */
export function getRoomFunctionColor(code: string | null): string {
  if (!code) return '#e2e8f0';
  const entry = ROOM_FUNCTION_DICTIONARY.find((e) => e.code === code);
  return entry?.color ?? '#cbd5e1';
}

/** 快捷键 → 房间功能代码映射 */
export const ROOM_SHORTCUT_MAP: Record<string, string> = {
  '1': 'living_room',
  '2': 'bedroom',
  '3': 'kitchen',
  '4': 'dining_room',
  '5': 'toilet',
  '6': 'storage',
  '7': 'corridor',
  '8': 'staircase',
  '9': 'other',
  '0': 'unknown',
};
