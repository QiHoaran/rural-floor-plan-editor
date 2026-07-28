// ============================================================
// 乡村住宅平面图人工矢量化与核验编辑器 — 核心类型定义
// ============================================================

// ---- 坐标系统 ----
export interface CoordinateSystem {
  type: 'local_cartesian';
  unit: 'cm';
  origin: 'bottom_left';
  y_axis: 'up';
  storage_precision_cm: 1;
  /** 像素与实际米的比例，标定后设置 */
  meters_per_pixel: number | null;
  /** 北向角度（度），相对于Y轴 */
  north_angle_deg: number | null;
}

// ---- 网格 ----
export type SnapMode = 'major' | 'minor' | 'fine' | 'none';

export interface GridSettings {
  major_step_cm: number;
  minor_step_cm: number;
  visible: boolean;
  snap_enabled: boolean;
  default_snap_mode: SnapMode;
}

// ---- 默认值 ----
export interface PlanDefaults {
  wall_thickness_cm: number;
  exterior_wall_thickness_cm: number;
  interior_wall_thickness_cm: number;
  wall_height_cm: number;
  door_width_cm: number;
  window_width_cm: number;
}

// ---- 图片 ----
export interface ImageInfo {
  file_name: string;
  width_px: number;
  height_px: number;
  opacity: number;
  rotation_deg: number;
  flip_horizontal: boolean;
  flip_vertical: boolean;
  /** 图片数据（Base64或Blob URL，用于IndexedDB存储） */
  data_url?: string;
}

// ---- 顶点 ----
export interface Vertex {
  x_cm: number;
  y_cm: number;
}

// ---- 墙体类型 ----
export type WallType = 'exterior' | 'interior' | 'partition' | 'unknown';

// ---- 墙体材料 ----
export type MaterialType = 'brick' | 'concrete' | 'wood' | 'rammed_earth' | 'stone' | 'other';

// ---- 审核状态 ----
export type ReviewStatus = 'draft' | 'reviewed' | 'approved' | 'rejected';

// ---- 墙体 ----
export interface Wall {
  start_vertex_id: string;
  end_vertex_id: string;
  wall_type: WallType;
  thickness_cm: number;
  height_cm: number;
  material_type: MaterialType;
  review_status: ReviewStatus;
  notes?: string;
}

// ---- 洞口类型 ----
export type OpeningType = 'door' | 'window' | 'entrance_door';

// ---- 门窗 ----
export interface Opening {
  opening_type: OpeningType;
  host_wall_id: string;
  /** 门窗中心点到墙起点的距离（cm） */
  offset_from_start_cm: number;
  width_cm: number;
  height_cm: number;
  /** 窗台高度（cm），门为0 */
  sill_height_cm: number;
  review_status: ReviewStatus;
  notes?: string;
}

// ---- 房间类型 ----
export type RoomType =
  | 'living_room'
  | 'bedroom'
  | 'kitchen'
  | 'dining_room'
  | 'hall'
  | 'toilet'
  | 'bathroom'
  | 'storage'
  | 'corridor'
  | 'stair'
  | 'balcony'
  | 'veranda'
  | 'courtyard'
  | 'utility'
  | 'unknown'
  | 'other';

// ---- 房间置信度 ----
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ---- 空间来源 ----
export type SpaceSource = 'derived_from_walls' | 'manual';

// ---- 空间/房间 ----
export interface Space {
  room_type: RoomType;
  /** 地方性名称，如"堂屋" */
  local_name: string;
  /** 房间多边形顶点坐标列表（cm），派生数据 */
  generated_polygon: [number, number][][] | null;
  source: SpaceSource;
  review_status: ReviewStatus;
  confidence: ConfidenceLevel;
  heated: boolean;
  notes?: string;
}

// ---- 空间关系类型 ----
export type RelationType = 'adjacent' | 'contains' | 'connects_to';

// ---- 空间关系 ----
export interface Relation {
  type: RelationType;
  from_space_id: string;
  to_space_id: string;
}

// ---- 校验级别 ----
export type ValidationLevel = 'error' | 'warning' | 'info';

// ---- 校验问题 ----
export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  entity_type: 'wall' | 'vertex' | 'opening' | 'space' | 'plan';
  entity_id: string | null;
}

// ---- 校验记录 ----
export interface ValidationRecord {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
}

// ---- 审核元数据 ----
export interface ReviewMetadata {
  status: ReviewStatus;
  reviewer: string | null;
  reviewed_at: string | null;
}

// ---- 元数据 ----
export interface Metadata {
  created_at: string | null;
  updated_at: string | null;
  revision: number;
}

// ---- 完整的 Plan Document ----
export interface PlanDocument {
  schema_version: string;
  plan_id: string;
  image: ImageInfo;
  coordinate_system: CoordinateSystem;
  grid: GridSettings;
  defaults: PlanDefaults;
  vertices: Record<string, Vertex>;
  walls: Record<string, Wall>;
  openings: Record<string, Opening>;
  spaces: Record<string, Space>;
  relations: Relation[];
  validation: ValidationRecord;
  review: ReviewMetadata;
  metadata: Metadata;
}

// ---- 工具类型 ----
export type ToolType =
  | 'select'
  | 'exterior_wall'
  | 'interior_wall'
  | 'continuous_wall'
  | 'rectangle_room'
  | 'door'
  | 'window'
  | 'calibrate'
  | 'north_arrow'
  | 'parallel_copy'
  | 'delete'
  | 'none';

// ---- 实体类型 ----
export type EntityType = 'wall' | 'vertex' | 'opening' | 'space' | 'none';

// ---- 保存状态 ----
export type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';

// ---- 锚点类型 ----
export type AnchorPoint = 'start' | 'end' | 'midpoint';

// ---- 墙长更新参数 ----
export interface WallLengthUpdate {
  wall_id: string;
  new_length_cm: number;
  anchor: AnchorPoint;
}

// ---- 平行复制参数 ----
export interface ParallelCopyParams {
  wall_ids: string[];
  offset_cm: number;
  direction: 'left' | 'right' | 'up' | 'down';
  count: number;
}

// ---- 镜像参数 ----
export interface MirrorParams {
  wall_ids: string[];
  axis: 'vertical' | 'horizontal';
  axis_position_cm: number;
}
