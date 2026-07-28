// ============================================================
// Plan JSON 序列化/反序列化
// ============================================================

import type { PlanDocument } from './planTypes.ts';
import { SCHEMA_VERSION } from './constants.ts';
import { seedFromExistingIds, resetCounters } from './ids.ts';

/**
 * 将 PlanDocument 序列化为 JSON 字符串
 */
export function serializePlan(doc: PlanDocument): string {
  const output = JSON.stringify(doc, null, 2);
  return output;
}

/**
 * 从 JSON 字符串反序列化 PlanDocument
 * 包含校验和修复逻辑
 */
export function deserializePlan(json: string): { doc: PlanDocument; warnings: string[] } {
  const warnings: string[] = [];
  let raw: any;

  // Step 1: JSON 语法检查
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON 语法错误: ${(e as Error).message}`);
  }

  // Step 2: 基本结构检查
  if (!raw || typeof raw !== 'object') {
    throw new Error('Plan JSON 必须是一个对象');
  }

  if (!raw.schema_version) {
    warnings.push('缺少 schema_version，将使用当前版本');
    raw.schema_version = SCHEMA_VERSION;
  }

  // Step 3: 版本兼容性检查
  if (raw.schema_version !== SCHEMA_VERSION) {
    warnings.push(`版本不匹配: 文件版本 ${raw.schema_version}，当前版本 ${SCHEMA_VERSION}`);
  }

  // Step 4: 必需字段检查
  const requiredFields = ['vertices', 'walls'];
  for (const field of requiredFields) {
    if (!raw[field]) {
      raw[field] = {};
      warnings.push(`缺少必需字段 "${field}"，已初始化为空`);
    }
  }

  // Step 5: ID 唯一性检查
  const allIds = new Set<string>();
  for (const key of ['vertices', 'walls', 'openings', 'spaces'] as const) {
    if (raw[key] && typeof raw[key] === 'object') {
      for (const id of Object.keys(raw[key])) {
        if (allIds.has(id)) {
          warnings.push(`重复 ID: ${id}`);
        }
        allIds.add(id);
      }
    }
  }

  // Step 6: 引用完整性检查
  if (raw.walls) {
    for (const [wallId, wall] of Object.entries(raw.walls) as any) {
      if (wall.start_vertex_id && !raw.vertices[wall.start_vertex_id]) {
        warnings.push(`墙 ${wallId} 引用了不存在的顶点 ${wall.start_vertex_id}`);
      }
      if (wall.end_vertex_id && !raw.vertices[wall.end_vertex_id]) {
        warnings.push(`墙 ${wallId} 引用了不存在的顶点 ${wall.end_vertex_id}`);
      }
    }
  }

  if (raw.openings) {
    for (const [opId, opening] of Object.entries(raw.openings) as any) {
      if (opening.host_wall_id && !raw.walls[opening.host_wall_id]) {
        warnings.push(`门窗 ${opId} 引用了不存在的墙 ${opening.host_wall_id}，标记为孤立`);
      }
    }
  }

  // Step 7: 设置 ID 计数器
  resetCounters();
  seedFromExistingIds(Array.from(allIds));

  // Step 8: 修复缺失字段
  if (!raw.openings) raw.openings = {};
  if (!raw.spaces) raw.spaces = {};
  if (!raw.relations) raw.relations = [];
  if (!raw.validation) raw.validation = { errors: [], warnings: [], infos: [] };
  if (!raw.metadata) {
    raw.metadata = {
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revision: 0,
    };
  }
  if (!raw.review) {
    raw.review = { status: 'draft', reviewer: null, reviewed_at: null };
  }
  if (!raw.coordinate_system) {
    raw.coordinate_system = {
      type: 'local_cartesian',
      unit: 'cm',
      origin: 'bottom_left',
      y_axis: 'up',
      storage_precision_cm: 1,
      meters_per_pixel: null,
      north_angle_deg: null,
    };
  }
  if (!raw.image) {
    raw.image = {
      file_name: '',
      width_px: 0,
      height_px: 0,
      opacity: 0.65,
      rotation_deg: 0,
      flip_horizontal: false,
      flip_vertical: false,
    };
  }
  if (!raw.grid) {
    raw.grid = { major_step_cm: 24, minor_step_cm: 6, visible: true, snap_enabled: true, default_snap_mode: 'major' };
  }
  if (!raw.defaults) {
    raw.defaults = { wall_thickness_cm: 24, exterior_wall_thickness_cm: 37, interior_wall_thickness_cm: 24, wall_height_cm: 300, door_width_cm: 90, window_width_cm: 120 };
  }
  if (!raw.plan_id) raw.plan_id = 'house_0001';

  return { doc: raw as PlanDocument, warnings };
}

/**
 * 下载 Plan JSON 文件
 */
export function downloadPlanJson(doc: PlanDocument): void {
  const json = serializePlan(doc);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.plan_id}.plan.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 加载 Plan JSON 文件
 */
export function loadPlanJson(file: File): Promise<{ doc: PlanDocument; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = deserializePlan(e.target?.result as string);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}
