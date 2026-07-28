export type Millimeters = number;
export type BuildingId = string;

export type WallElementType =
  | 'exterior_door'
  | 'exterior_window'
  | 'interior_door'
  | 'passage';

export type RelationType = 'opening' | 'connection';
export type BuildingValidationLevel = 'error' | 'warning';

export interface BuildingValidationIssue {
  id: string;
  level: BuildingValidationLevel;
  code: string;
  message: string;
  entity?: {
    type: 'wall' | 'wall_element' | 'face' | 'vertex' | 'outside_region';
    id: string;
  };
}

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

export interface BuildingFace {
  boundary_vertex_ids: string[];
  area_mm2: number;
  function_code: string | null;
  display_name: string;
  color: string;
  local_name: string;
  notes?: string;
}

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

export interface OutsideRegion {
  boundary_vertex_ids: string[];
  region_type: 'courtyard';
}

export interface BuildingFloor {
  floor_id: 'floor_1';
  name: '一层';
  wall_ids: string[];
  face_ids: string[];
}

export interface CustomFunctionType {
  code: string;
  name: string;
  color: string;
}

export interface BuildingDocument {
  schema_version: '2.0.0';
  building_id: BuildingId;
  coordinate_system: {
    type: 'local_cartesian';
    input_unit: 'm';
    storage_unit: 'mm';
    origin: 'bottom_left';
    precision_mm: 1;
  };
  building_defaults: BuildingDefaults;
  reference_image: ReferenceImage;
  floors: [BuildingFloor];
  vertices: Record<string, BuildingVertex>;
  walls: Record<string, BuildingWall>;
  wall_elements: Record<string, WallElement>;
  faces: Record<string, BuildingFace>;
  outside_regions: Record<string, OutsideRegion>;
  relations: BuildingRelation[];
  custom_function_types: CustomFunctionType[];
  validation: {
    issues: BuildingValidationIssue[];
  };
  metadata: {
    created_at: string;
    updated_at: string;
    revision: number;
    status: 'draft' | 'complete';
  };
}
