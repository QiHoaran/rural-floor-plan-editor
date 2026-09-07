// ============================================================
// 集中配置常量 — 禁止散落的魔法数字
// v2.1.0: 统一毫米单位（BuildingDocument 数据模型）
// ============================================================

// ---- Schema ----
export const CURRENT_SCHEMA_VERSION = '2.1.0'; // 当前 BuildingDocument schema

// ---- 参考图方向 ----
/** 参考图统一采用：上北、下南、左西、右东。 */
export const DEFAULT_NORTH_ANGLE_DEG = 0;
export const REFERENCE_DIRECTION_LABEL = '上北 · 下南 · 左西 · 右东';

// ---- 墙体（mm，BuildingDocument 使用） ----
export const DEFAULT_WALL_THICKNESS_MM = 240;
export const DEFAULT_EXTERIOR_WALL_THICKNESS_MM = 370;
export const DEFAULT_INTERIOR_WALL_THICKNESS_MM = 240;
export const DEFAULT_WALL_HEIGHT_MM = 3000;

export const WALL_THICKNESS_PRESETS_MM = [120, 180, 240, 370, 490] as const;
export const MIN_WALL_LENGTH_MM = 100;

// ---- 门窗（mm，BuildingDocument 使用） ----
export const DEFAULT_DOOR_WIDTH_MM = 1000;
export const DEFAULT_WINDOW_WIDTH_MM = 1300;
export const DEFAULT_DOOR_HEIGHT_MM = 2100;
export const DEFAULT_WINDOW_HEIGHT_MM = 1500;
export const DEFAULT_SILL_HEIGHT_MM = 900;
export const DEFAULT_PASSAGE_WIDTH_MM = 1000;
export const DEFAULT_PASSAGE_HEIGHT_MM = 2100;

/** 构件「尺寸」预设（沿墙方向开口宽度，单位 mm；对应 0.5/1/1.3/1.7/2 m） */
export const WALL_ELEMENT_SIZE_PRESETS_MM = [500, 1000, 1300, 1700, 2000] as const;

// ---- 房间（mm，BuildingDocument 使用） ----
export const MIN_ROOM_AREA_MM2 = 500_000; // 0.5 m²

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
  '1': 'bedroom',
  '2': 'living_room',
  '3': 'dining_room',
};
