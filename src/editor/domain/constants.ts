// ============================================================
// 集中配置常量 — 禁止散落的魔法数字
// ============================================================

import type { GridSettings, PlanDefaults, SnapMode } from './planTypes.ts';

// ---- Schema ----
export const SCHEMA_VERSION = '0.2.0';

// ---- 网格 ----
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

// ---- 墙体 ----
export const DEFAULT_WALL_THICKNESS_CM = 24;
export const DEFAULT_EXTERIOR_WALL_THICKNESS_CM = 37;
export const DEFAULT_INTERIOR_WALL_THICKNESS_CM = 24;
export const DEFAULT_WALL_HEIGHT_CM = 300;

export const WALL_THICKNESS_PRESETS = [12, 18, 24, 37, 49] as const;

export const MIN_WALL_LENGTH_CM = 10;

// ---- 门窗 ----
export const DEFAULT_DOOR_WIDTH_CM = 90;
export const DEFAULT_WINDOW_WIDTH_CM = 120;

export const DOOR_WIDTH_PRESETS = [70, 80, 90, 100, 120, 150] as const;
export const WINDOW_WIDTH_PRESETS = [60, 90, 120, 150, 180] as const;

export const DEFAULT_DOOR_HEIGHT_CM = 210;
export const DEFAULT_WINDOW_HEIGHT_CM = 150;
export const DEFAULT_SILL_HEIGHT_CM = 90;

// ---- 默认值集合 ----
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
/** 缩放级别对应比例尺，zooms below this threshold show only super grid */
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
export const AUTO_SAVE_DELAY_MS = 1000;

// ---- IndexedDB ----
export const DB_NAME = 'rural-floor-plan-editor';
export const DB_VERSION = 1;
export const DB_STORE_NAME = 'projects';

// ---- 房间 ----
export const MIN_ROOM_AREA_CM2 = 5000; // 0.5 m²
export const MAX_ROOM_ASPECT_RATIO = 20;

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
};

/** 墙体类型对应的显示颜色 */
export const WALL_TYPE_COLORS: Record<string, string> = {
  exterior: COLORS.EXTERIOR_WALL,
  interior: COLORS.INTERIOR_WALL,
  partition: COLORS.PARTITION_WALL,
  unknown: COLORS.INTERIOR_WALL,
};
