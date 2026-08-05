// ============================================================
// BuildingDocument — v2.1.0 唯一正式领域模型
// 所有几何坐标统一为毫米 (mm)
// ============================================================

export type Millimeters = number;
export type BuildingId = string;

// ---- 墙体元素类型 ----
export type WallElementType =
  | 'exterior_door'
  | 'exterior_window'
  | 'interior_door'
  | 'passage';

export type RelationType = 'opening' | 'connection';

// ---- 校验 ----
export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationCategory =
  | 'schema'
  | 'geometry'
  | 'topology'
  | 'semantic'
  | 'accessibility'
  | 'ventilation'
  | 'daylighting'
  | 'reference'
  | 'workflow';

export type ValidationEntityType =
  | 'building'
  | 'vertex'
  | 'wall'
  | 'wall_element'
  | 'face'
  | 'outside_region';

export interface ValidationIssue {
  id: string;
  code: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  message_key: string;
  message_params?: Record<string, string | number>;
  entity_type?: ValidationEntityType;
  entity_id?: string;
  fix_suggestion_key?: string;
  created_at: string;
}

// ---- 旧版兼容（逐步迁移） ----
export interface BuildingValidationIssue {
  id: string;
  level: 'error' | 'warning';
  code: string;
  message: string;
  entity?: {
    type: 'wall' | 'wall_element' | 'face' | 'vertex' | 'outside_region';
    id: string;
  };
}

// ---- 参考图 ----
export interface ReferenceImage {
  path: string;
  mime_type: string;
  width_px: number;
  height_px: number;
  opacity: number;
  transform: {
    translate_x_mm: Millimeters;
    translate_y_mm: Millimeters;
    scale: number;
    rotation_deg: number;
  };
}

/** 两点比例标定数据 */
export interface ReferenceCalibration {
  calibrated: boolean;
  point_a_image: { x: number; y: number };
  point_b_image: { x: number; y: number };
  real_distance_mm: Millimeters;
  mm_per_image_pixel: number;
  calibrated_at: string;
}

// ---- 建筑元数据 ----
export interface BuildingMetadata {
  name: string;
  village_code?: string;
  household_code?: string;
  floor_index: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  revision: number;
  status: WorkflowStatus;
}

// ---- 住户与建筑调查属性 ----
export type GenderValue = '男性' | '女性';
export type FamilyStructureValue =
  | '两人户（年轻夫妻）'
  | '两人户（老年夫妻）'
  | '中年夫妻 + 未婚子女'
  | '老年夫妻 + 已婚子女'
  | '三代户'
  | '隔代户（老年夫妻 + 隔代儿童）'
  | '独居';
export type AnnualIncomeValue =
  | '小于 10000'
  | '10000–20000'
  | '20001–30000'
  | '30001–40000'
  | '40000–50000'
  | '50001 以上';
export type IncomeSourceValue = '养殖' | '种田' | '果林' | '经商' | '打工' | '其他副业';
export type ConstructionEraValue =
  | '1950 年代'
  | '1960 年代'
  | '1970 年代'
  | '1980 年代'
  | '1990 年代'
  | '2000 年及以后'
  | '1940 年代'
  | '1930 年代'
  | '1920 年代及以前'
  | '不确定';
export type BuildingAreaValue =
  | '20–30 ㎡'
  | '30–40 ㎡'
  | '40–50 ㎡'
  | '50–60 ㎡'
  | '60–70 ㎡'
  | '70–80 ㎡'
  | '80–90 ㎡'
  | '90–100 ㎡'
  | '100–110 ㎡';
export type PlanFormValue = '一字型' | 'L 型' | 'U 型' | '回字型' | '其他';
export type BuildingStructureValue =
  | '土坯结构'
  | '砖瓦结构'
  | '砖混结构'
  | '钢筋混凝土结构'
  | '石结构';

export interface HouseholdSurvey {
  village_code: string;
  household_code: string;
  gender?: GenderValue;
  age?: number;
  resident_count?: number;
  family_structure?: FamilyStructureValue;
  annual_income?: AnnualIncomeValue;
  primary_income_source?: IncomeSourceValue;
  construction_era?: ConstructionEraValue;
  building_area?: BuildingAreaValue;
  clear_height_mm?: Millimeters;
  plan_form?: PlanFormValue;
  building_structure?: BuildingStructureValue;
  main_room_bay_mm?: Millimeters;
  main_room_width_mm?: Millimeters;
  wing_room_bay_mm?: Millimeters;
  wing_room_width_mm?: Millimeters;
  bay_count?: number;
}

// ---- 场地信息 ----
export interface BuildingSite {
  /** 0° 表示参考图正上方为北；当前约定固定为上北下南、左西右东。 */
  north_angle_deg: number;
  location_name?: string;
  climate_zone?: string;
}

// ---- 工作流状态 ----
export type WorkflowStatus =
  | 'draft'
  | 'pending_review'
  | 'reviewed'
  | 'complete';

export interface WorkflowState {
  status: WorkflowStatus;
  reviewer?: string;
  reviewed_at?: string;
  completed_at?: string;
  ignored_warnings?: Array<{
    issue_id: string;
    reason?: string;
    ignored_at: string;
  }>;
}

// ---- 统计 ----
export interface BuildingStatistics {
  geometry_progress: number;
  room_semantic_progress: number;
  opening_progress: number;
  validation_error_count: number;
  validation_warning_count: number;
  total_floor_area_m2: number;
  room_count: number;
}

// ---- 基础几何实体 ----
export interface BuildingVertex {
  x_mm: Millimeters;
  y_mm: Millimeters;
}

export interface BuildingDefaults {
  wall_thickness_mm: Millimeters;
  wall_height_mm: Millimeters;
  snap_enabled: boolean;
  grid_size_mm: Millimeters;
}

export interface BuildingWall {
  start_vertex_id: string;
  end_vertex_id: string;
  wall_type: 'exterior' | 'interior' | 'partition';
  thickness_mm: Millimeters;
  height_mm: Millimeters;
  material_type:
    | 'brick'
    | 'concrete'
    | 'wood'
    | 'rammed_earth'
    | 'stone'
    | 'other';
  notes?: string;
}

// ---- 墙体构件（门窗/洞口） ----
export interface WallElement {
  element_type: WallElementType;
  host_wall_id: string;
  offset_from_start_mm: Millimeters;
  width_mm: Millimeters;
  height_mm: Millimeters;
  sill_height_mm: Millimeters;
  status: 'valid' | 'needs_review';
  notes?: string;
}

// ---- 房间面 ----
export interface FaceProperties {
  function_code: string;
  display_name?: string;
  floor_finish?: string;
  occupied?: boolean;
  heated?: boolean;
  notes?: string;
}

export interface BuildingFace {
  boundary_vertex_ids: string[];
  area_mm2: number;
  function_code: string | null;
  display_name: string;
  color: string;
  local_name: string;
  /** v2.1.0 扩展属性 */
  floor_finish?: string;
  occupied?: boolean;
  heated?: boolean;
  notes?: string;
}

// ---- 空间关系 ----
export interface BuildingRelation {
  relation_type: RelationType;
  wall_element_id: string;
  from_face_id: string;
  to: { kind: 'outside' } | { kind: 'face'; face_id: string };
  channels: RelationChannels;
}

export interface RelationChannels {
  people: boolean;
  air: boolean;
  light: boolean;
}

// ---- 室外区域（院落等） ----
export interface OutsideRegion {
  boundary_vertex_ids: string[];
  region_type: 'courtyard';
}

// ---- 楼层 ----
export interface BuildingFloor {
  floor_id: string;
  name: string;
  wall_ids: string[];
  face_ids: string[];
}

// ---- 自定义功能类型 ----
export interface CustomFunctionType {
  code: string;
  name: string;
  color: string;
}

// ---- 坐标系统 ----
export interface CoordinateSystem {
  type: 'local_cartesian';
  input_unit: 'm';
  storage_unit: 'mm';
  origin: 'bottom_left';
  precision_mm: 1;
}

// ============================================================
// 核心文档类型 — BuildingDocument v2.1.0
// ============================================================

export interface BuildingDocument {
  schema_version: string;
  building_id: BuildingId;

  /** v2.1.0 建筑元数据 */
  metadata: BuildingMetadata;

  /** 住户与建筑调查属性，可通过单条录入或批量导入维护 */
  survey?: HouseholdSurvey;

  /** v2.1.0 场地信息 */
  site: BuildingSite;

  /** v2.1.0 工作流状态 */
  workflow: WorkflowState;

  coordinate_system: CoordinateSystem;
  building_defaults: BuildingDefaults;

  /** 参考图及标定信息 */
  reference_image: ReferenceImage;
  reference_calibration?: ReferenceCalibration;

  /** v2.1.0 建筑统计（运行时计算，不持久化到 autosave） */
  statistics?: BuildingStatistics;

  floors: BuildingFloor[];

  // ---- 几何数据 ----
  vertices: Record<string, BuildingVertex>;
  walls: Record<string, BuildingWall>;
  wall_elements: Record<string, WallElement>;
  faces: Record<string, BuildingFace>;
  outside_regions: Record<string, OutsideRegion>;

  // ---- 关系与校验 ----
  relations: BuildingRelation[];
  validation: {
    issues: BuildingValidationIssue[];
  };
  /** v2.1.0 结构化校验问题 */
  structured_validation?: ValidationIssue[];

  custom_function_types: CustomFunctionType[];
}
