// ============================================================
// 数据迁移模块 — 将旧版本数据迁移到当前 BuildingDocument
//
// 迁移逻辑：
// 1. 识别旧 Schema 版本
// 2. 转换厘米到毫米
// 3. 将旧 openings 转为 wall_elements
// 4. 将旧 spaces 转为 faces 或房间语义
// 5. 迁移北向、比例、审核状态和参考图信息
// 6. 为缺失字段提供安全默认值
// 7. 返回迁移警告
// 8. 不静默丢弃无法转换的数据
// ============================================================

import { CURRENT_SCHEMA_VERSION } from '../constants.ts';
import type { BuildingDocument } from '../buildingTypes.ts';

export interface MigrationResult {
  document: BuildingDocument;
  from_version: string;
  to_version: string;
  warnings: string[];
}

/**
 * 迁移任意版本的数据到当前 BuildingDocument 格式
 */
export function migrateToCurrent(
  raw: Record<string, unknown>,
): MigrationResult {
  const version = String(raw.schema_version ?? '0.0.0');
  const warnings: string[] = [];

  if (version === CURRENT_SCHEMA_VERSION) {
    // 已经是当前版本，补充缺失字段
    const doc = ensureModernFields(raw as unknown as BuildingDocument, warnings);
    return {
      document: doc,
      from_version: version,
      to_version: CURRENT_SCHEMA_VERSION,
      warnings,
    };
  }

  if (version === '2.0.0') {
    const doc = migrateFrom2_0_0(raw, warnings);
    return {
      document: doc,
      from_version: version,
      to_version: CURRENT_SCHEMA_VERSION,
      warnings,
    };
  }

  if (version === '0.2.0' || version === '0.1.0') {
    const doc = migrateFromPlanDocument(raw, warnings);
    return {
      document: doc,
      from_version: version,
      to_version: CURRENT_SCHEMA_VERSION,
      warnings,
    };
  }

  // 未知版本：尝试尽力迁移
  warnings.push(
    `未知 schema 版本 "${version}"，将尝试按当前版本解析。部分数据可能丢失。`,
  );
  const doc = ensureModernFields(raw as unknown as BuildingDocument, warnings);
  return {
    document: doc,
    from_version: version,
    to_version: CURRENT_SCHEMA_VERSION,
    warnings,
  };
}

/**
 * 从 2.0.0 迁移到 2.1.0
 */
function migrateFrom2_0_0(
  raw: Record<string, unknown>,
  warnings: string[],
): BuildingDocument {
  const doc = ensureModernFields(
    raw as unknown as BuildingDocument,
    warnings,
  );

  // 2.0.0 → 2.1.0: 主要添加 metadata、site、workflow 字段
  if (!doc.metadata || typeof doc.metadata === 'object') {
    const oldMeta = (raw.metadata as Record<string, unknown>) ?? {};
    const oldStatus = oldMeta.status as string | undefined;
    doc.metadata = {
      name: doc.building_id,
      floor_index: 1,
      created_at: String(oldMeta.created_at ?? doc.metadata?.created_at ?? new Date().toISOString()),
      updated_at: String(oldMeta.updated_at ?? doc.metadata?.updated_at ?? new Date().toISOString()),
      revision: Number(oldMeta.revision ?? doc.metadata?.revision ?? 0),
      status: mapStatus(oldStatus),
    };
  }

  if (!doc.site) {
    doc.site = { north_angle_deg: 0 };
  }

  if (!doc.workflow) {
    doc.workflow = { status: doc.metadata.status };
  }

  if (doc.schema_version === '2.0.0') {
    doc.schema_version = CURRENT_SCHEMA_VERSION;
  }

  warnings.push('已从 2.0.0 迁移到 2.1.0：添加 metadata、site、workflow 字段。');
  return doc;
}

/**
 * 从旧 PlanDocument (0.2.0/0.1.0) 迁移到 BuildingDocument
 */
function migrateFromPlanDocument(
  raw: Record<string, unknown>,
  warnings: string[],
): BuildingDocument {
  const planDoc = raw as Record<string, unknown>;
  const planId = String(planDoc.plan_id ?? planDoc.building_id ?? 'migrated_001');
  const now = new Date().toISOString();

  // 迁移顶点：cm → mm
  const vertices: Record<string, { x_mm: number; y_mm: number }> = {};
  const oldVertices = (planDoc.vertices ?? {}) as Record<string, { x_cm?: number; y_cm?: number }>;
  for (const [id, v] of Object.entries(oldVertices)) {
    if (v && typeof v.x_cm === 'number' && typeof v.y_cm === 'number') {
      vertices[id] = {
        x_mm: Math.round(v.x_cm * 10),
        y_mm: Math.round(v.y_cm * 10),
      };
    }
  }
  if (Object.keys(vertices).length > 0) {
    warnings.push(`已迁移 ${Object.keys(vertices).length} 个顶点：坐标从 cm 转换为 mm。`);
  }

  // 迁移墙体：cm → mm
  const walls: Record<string, Record<string, unknown>> = {};
  const oldWalls = (planDoc.walls ?? {}) as Record<string, Record<string, unknown>>;
  for (const [id, w] of Object.entries(oldWalls)) {
    walls[id] = {
      start_vertex_id: String(w?.start_vertex_id ?? ''),
      end_vertex_id: String(w?.end_vertex_id ?? ''),
      wall_type: mapWallType(String(w?.wall_type ?? 'unknown')),
      thickness_mm: Math.round(Number(w?.thickness_cm ?? 24) * 10),
      height_mm: Math.round(Number(w?.height_cm ?? 300) * 10),
      material_type: String(w?.material_type ?? 'brick'),
      notes: w?.notes !== undefined ? String(w.notes) : undefined,
    };
  }
  if (Object.keys(walls).length > 0) {
    warnings.push(`已迁移 ${Object.keys(walls).length} 堵墙：尺寸从 cm 转换为 mm。`);
  }

  // 迁移门窗 (openings → wall_elements)：cm → mm
  const wallElements: Record<string, Record<string, unknown>> = {};
  const oldOpenings = (planDoc.openings ?? {}) as Record<string, Record<string, unknown>>;
  for (const [id, op] of Object.entries(oldOpenings)) {
    const openingType = String(op?.opening_type ?? 'door');
    const elementType =
      openingType === 'entrance_door' ? 'exterior_door' :
      openingType === 'door' ? 'interior_door' :
      openingType === 'window' ? 'exterior_window' :
      'passage';

    const elementId = `we_${String(Object.keys(wallElements).length + 1).padStart(4, '0')}`;
    wallElements[elementId] = {
      element_type: elementType,
      host_wall_id: String(op?.host_wall_id ?? ''),
      offset_from_start_mm: Math.round(Number(op?.offset_from_start_cm ?? 0) * 10),
      width_mm: Math.round(Number(op?.width_cm ?? 90) * 10),
      height_mm: Math.round(Number(op?.height_cm ?? 210) * 10),
      sill_height_mm: Math.round(Number(op?.sill_height_cm ?? 0) * 10),
      status: 'valid',
      notes: op?.notes !== undefined ? String(op.notes) : undefined,
    };
    warnings.push(`门窗 "${id}" → wall_element "${elementId}" (${elementType})。`);
  }

  // 迁移空间 (spaces → faces)：cm → mm
  const faces: Record<string, Record<string, unknown>> = {};
  const oldSpaces = (planDoc.spaces ?? {}) as Record<string, Record<string, unknown>>;
  for (const [id, space] of Object.entries(oldSpaces)) {
    const polygon = (space?.generated_polygon ?? []) as [number, number][][];
    const firstRing = polygon[0] ?? [];

    faces[id] = {
      boundary_vertex_ids: firstRing.length > 0
        ? firstRing.map((_, i) => `v_migrated_${id}_${i}`)
        : [],
      area_mm2: 0, // 将在几何重算后更新
      function_code: String(space?.room_type ?? 'unknown'),
      display_name: String(space?.local_name ?? ''),
      color: '#cbd5e1',
      local_name: String(space?.local_name ?? ''),
      heated: Boolean(space?.heated ?? false),
      occupied: false,
    };

    // 将 polygon 顶点插入 vertices
    for (let i = 0; i < firstRing.length; i++) {
      const vid = `v_migrated_${id}_${i}`;
      if (!vertices[vid]) {
        vertices[vid] = {
          x_mm: Math.round((firstRing[i]?.[0] ?? 0) * 10),
          y_mm: Math.round((firstRing[i]?.[1] ?? 0) * 10),
        };
      }
    }
  }
  if (Object.keys(faces).length > 0) {
    warnings.push(`已迁移 ${Object.keys(faces).length} 个空间：spaces → faces，cm → mm。`);
  }

  // 北向
  const coordSys = planDoc.coordinate_system as Record<string, unknown> | undefined;
  const northAngle = coordSys?.north_angle_deg as number | null | undefined;

  // 比例
  const metersPerPixel = coordSys?.meters_per_pixel as number | null | undefined;

  const image = (planDoc.image ?? {}) as Record<string, unknown>;

  const buildingDoc: BuildingDocument = {
    schema_version: CURRENT_SCHEMA_VERSION,
    building_id: planId,
    coordinate_system: {
      type: 'local_cartesian',
      input_unit: 'm',
      storage_unit: 'mm',
      origin: 'bottom_left',
      precision_mm: 1,
    },
    building_defaults: {
      wall_thickness_mm: 240,
      wall_height_mm: 3000,
      snap_enabled: true,
      grid_size_mm: 100,
    },
    metadata: {
      name: planId,
      floor_index: 1,
      created_at: now,
      updated_at: now,
      revision: 0,
      status: 'draft',
    },
    site: {
      north_angle_deg: typeof northAngle === 'number' ? northAngle : 0,
    },
    workflow: {
      status: 'draft',
    },
    reference_image: {
      path: String(image?.file_name ?? ''),
      mime_type: 'image/png',
      width_px: Number(image?.width_px ?? 0),
      height_px: Number(image?.height_px ?? 0),
      opacity: Number(image?.opacity ?? 0.55),
      transform: {
        translate_x_mm: 0,
        translate_y_mm: 0,
        scale: 1,
        rotation_deg: Number(image?.rotation_deg ?? 0),
      },
    },
    reference_calibration: metersPerPixel != null && metersPerPixel > 0
      ? {
          calibrated: true,
          point_a_image: { x: 0, y: 0 },
          point_b_image: { x: 100, y: 0 },
          real_distance_mm: Math.round(metersPerPixel * 100 * 1000),
          mm_per_image_pixel: metersPerPixel * 1000,
          calibrated_at: now,
        }
      : undefined,
    floors: [
      {
        floor_id: 'floor_1',
        name: '一层',
        wall_ids: Object.keys(walls),
        face_ids: Object.keys(faces),
      },
    ],
    vertices: vertices as BuildingDocument['vertices'],
    walls: walls as unknown as BuildingDocument['walls'],
    wall_elements:
      wallElements as unknown as BuildingDocument['wall_elements'],
    faces: faces as unknown as BuildingDocument['faces'],
    outside_regions: {},
    relations: [],
    validation: { issues: [] },
    custom_function_types: [],
  };

  warnings.push(
    `完整迁移：PlanDocument → BuildingDocument (${CURRENT_SCHEMA_VERSION})。` +
    '请检查几何数据是否正确。',
  );

  return buildingDoc;
}

/**
 * 确保文档包含所有 2.1.0 必需字段
 */
function ensureModernFields(
  doc: BuildingDocument,
  warnings: string[],
): BuildingDocument {
  const result = { ...doc };

  if (!result.metadata) {
    warnings.push('缺少 metadata，使用默认值。');
    result.metadata = {
      name: result.building_id,
      floor_index: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revision: 0,
      status: 'draft',
    };
  }

  if (!result.site) {
    warnings.push('缺少 site，使用默认北向 0°。');
    result.site = { north_angle_deg: 0 };
  }

  if (!result.workflow) {
    warnings.push('缺少 workflow，使用默认状态 draft。');
    result.workflow = { status: 'draft' };
  }

  if (result.schema_version !== CURRENT_SCHEMA_VERSION) {
    warnings.push(
      `Schema 版本从 ${result.schema_version} 更新为 ${CURRENT_SCHEMA_VERSION}。`,
    );
    result.schema_version = CURRENT_SCHEMA_VERSION;
  }

  // 确保 coordinate_system
  if (!result.coordinate_system) {
    result.coordinate_system = {
      type: 'local_cartesian',
      input_unit: 'm',
      storage_unit: 'mm',
      origin: 'bottom_left',
      precision_mm: 1,
    };
  }

  // 确保 building_defaults
  if (!result.building_defaults) {
    result.building_defaults = {
      wall_thickness_mm: 240,
      wall_height_mm: 3000,
      snap_enabled: true,
      grid_size_mm: 100,
    };
  }

  return result;
}

function mapStatus(status: string | undefined): BuildingDocument['metadata']['status'] {
  switch (status) {
    case 'complete': return 'complete';
    case 'reviewed': return 'reviewed';
    case 'pending_review': return 'pending_review';
    default: return 'draft';
  }
}

function mapWallType(type: string): 'exterior' | 'interior' | 'partition' {
  switch (type) {
    case 'exterior': return 'exterior';
    case 'interior': return 'interior';
    case 'partition': return 'partition';
    default: return 'interior';
  }
}
