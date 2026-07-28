// ============================================================
// BuildingDocument 结构化校验系统
//
// 问题代码规范化，支持中英文消息映射
// v2.1.0
// ============================================================

import type {
  BuildingDocument,
  ValidationIssue,
  ValidationSeverity,
  ValidationCategory,
  ValidationEntityType,
} from './buildingTypes.ts';

// ---- 问题定义 ----
interface IssueDefinition {
  code: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  message_key: string;
  fix_suggestion_key?: string;
}

const ISSUE_DEFINITIONS: Record<string, IssueDefinition> = {
  SCHEMA_INVALID: {
    code: 'SCHEMA_INVALID',
    severity: 'error',
    category: 'schema',
    message_key: 'validation.schema_invalid',
    fix_suggestion_key: 'fix.schema_invalid',
  },
  WALL_ZERO_LENGTH: {
    code: 'WALL_ZERO_LENGTH',
    severity: 'error',
    category: 'geometry',
    message_key: 'validation.wall_zero_length',
    fix_suggestion_key: 'fix.wall_zero_length',
  },
  WALL_DUPLICATED: {
    code: 'WALL_DUPLICATED',
    severity: 'warning',
    category: 'geometry',
    message_key: 'validation.wall_duplicated',
    fix_suggestion_key: 'fix.wall_duplicated',
  },
  WALL_INTERSECTION_INVALID: {
    code: 'WALL_INTERSECTION_INVALID',
    severity: 'error',
    category: 'geometry',
    message_key: 'validation.wall_intersection_invalid',
    fix_suggestion_key: 'fix.wall_intersection_invalid',
  },
  FACE_NOT_CLOSED: {
    code: 'FACE_NOT_CLOSED',
    severity: 'error',
    category: 'topology',
    message_key: 'validation.face_not_closed',
  },
  FACE_AREA_TOO_SMALL: {
    code: 'FACE_AREA_TOO_SMALL',
    severity: 'warning',
    category: 'geometry',
    message_key: 'validation.face_area_too_small',
  },
  FACE_FUNCTION_MISSING: {
    code: 'FACE_FUNCTION_MISSING',
    severity: 'warning',
    category: 'semantic',
    message_key: 'validation.face_function_missing',
    fix_suggestion_key: 'fix.face_function_missing',
  },
  OPENING_WITHOUT_HOST_WALL: {
    code: 'OPENING_WITHOUT_HOST_WALL',
    severity: 'error',
    category: 'topology',
    message_key: 'validation.opening_without_host_wall',
    fix_suggestion_key: 'fix.opening_without_host_wall',
  },
  OPENING_OUTSIDE_WALL: {
    code: 'OPENING_OUTSIDE_WALL',
    severity: 'error',
    category: 'geometry',
    message_key: 'validation.opening_outside_wall',
    fix_suggestion_key: 'fix.opening_outside_wall',
  },
  OPENING_OVERLAP: {
    code: 'OPENING_OVERLAP',
    severity: 'warning',
    category: 'geometry',
    message_key: 'validation.opening_overlap',
    fix_suggestion_key: 'fix.opening_overlap',
  },
  ROOM_NOT_ACCESSIBLE: {
    code: 'ROOM_NOT_ACCESSIBLE',
    severity: 'error',
    category: 'accessibility',
    message_key: 'validation.room_not_accessible',
    fix_suggestion_key: 'fix.room_not_accessible',
  },
  ROOM_NO_AIR_PATH: {
    code: 'ROOM_NO_AIR_PATH',
    severity: 'warning',
    category: 'ventilation',
    message_key: 'validation.room_no_air_path',
    fix_suggestion_key: 'fix.room_no_air_path',
  },
  ROOM_NO_DIRECT_DAYLIGHT: {
    code: 'ROOM_NO_DIRECT_DAYLIGHT',
    severity: 'warning',
    category: 'daylighting',
    message_key: 'validation.room_no_direct_daylight',
    fix_suggestion_key: 'fix.room_no_direct_daylight',
  },
  REFERENCE_SCALE_MISSING: {
    code: 'REFERENCE_SCALE_MISSING',
    severity: 'warning',
    category: 'reference',
    message_key: 'validation.reference_scale_missing',
    fix_suggestion_key: 'fix.reference_scale_missing',
  },
  NORTH_ANGLE_MISSING: {
    code: 'NORTH_ANGLE_MISSING',
    severity: 'warning',
    category: 'reference',
    message_key: 'validation.north_angle_missing',
    fix_suggestion_key: 'fix.north_angle_missing',
  },
};

// ---- 中文消息映射 ----
const ZH_MESSAGES: Record<string, string> = {
  'validation.schema_invalid': '数据格式不符合 Schema 规范',
  'validation.wall_zero_length': '墙体长度为零',
  'validation.wall_duplicated': '存在重复墙体',
  'validation.wall_intersection_invalid': '墙体交叉关系无效',
  'validation.face_not_closed': '房间区域未闭合',
  'validation.face_area_too_small': '房间面积过小',
  'validation.face_function_missing': '房间功能未标注',
  'validation.opening_without_host_wall': '门窗缺少宿主墙体',
  'validation.opening_outside_wall': '门窗超出墙体范围',
  'validation.opening_overlap': '门窗与同一墙体上其他构件重叠',
  'validation.room_not_accessible': '房间无人员可达路径',
  'validation.room_no_air_path': '房间无通风路径',
  'validation.room_no_direct_daylight': '房间无直接自然采光',
  'validation.reference_scale_missing': '未完成比例标定',
  'validation.north_angle_missing': '未设置北向',
  'fix.schema_invalid': '请检查数据格式是否完整',
  'fix.wall_zero_length': '请删除零长度墙体或修改端点',
  'fix.wall_duplicated': '请删除重复的墙体',
  'fix.wall_intersection_invalid': '请在墙体交叉处添加顶点',
  'fix.face_function_missing': '请为房间选择功能类型',
  'fix.opening_without_host_wall': '请将门窗关联到有效墙体',
  'fix.opening_outside_wall': '请将门窗移动到墙体范围内',
  'fix.opening_overlap': '请调整门窗位置避免重叠',
  'fix.room_not_accessible': '请添加通往室外的门或通道',
  'fix.room_no_air_path': '请添加可开启门窗以形成通风路径',
  'fix.room_no_direct_daylight': '请添加外窗以提供自然采光',
  'fix.reference_scale_missing': '请使用比例标定工具指定参考距离',
  'fix.north_angle_missing': '请使用北向工具设置建筑朝向',
};

/**
 * 获取校验问题的中文显示消息
 */
export function getValidationMessageZh(issue: ValidationIssue): string {
  return ZH_MESSAGES[issue.message_key] ?? issue.message_key;
}

/**
 * 获取修复建议的中文显示消息
 */
export function getFixSuggestionZh(issue: ValidationIssue): string | null {
  if (!issue.fix_suggestion_key) return null;
  return ZH_MESSAGES[issue.fix_suggestion_key] ?? null;
}

/**
 * 创建结构化校验问题
 */
export function createValidationIssue(
  code: string,
  entityType?: ValidationEntityType,
  entityId?: string,
  params?: Record<string, string | number>,
): ValidationIssue {
  const def = ISSUE_DEFINITIONS[code];
  if (!def) {
    return {
      id: `${code.toLowerCase()}:${entityId ?? 'building'}:${Date.now()}`,
      code,
      severity: 'error',
      category: 'geometry',
      message_key: code,
      message_params: params,
      entity_type: entityType,
      entity_id: entityId,
      created_at: new Date().toISOString(),
    };
  }

  return {
    id: `${def.code.toLowerCase()}:${entityId ?? 'building'}:${Date.now()}`,
    ...def,
    message_params: params,
    entity_type: entityType,
    entity_id: entityId,
    created_at: new Date().toISOString(),
  };
}

/**
 * 运行 BuildingDocument 完整校验
 */
export function validateBuildingDocumentFull(
  document: BuildingDocument,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 几何校验
  issues.push(...validateGeometry(document));

  // 拓扑校验
  issues.push(...validateTopology(document));

  // 语义校验
  issues.push(...validateSemantics(document));

  // 参考校验
  issues.push(...validateReference(document));

  return issues;
}

function validateGeometry(document: BuildingDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 零长度墙
  for (const [wallId, wall] of Object.entries(document.walls)) {
    const start = document.vertices[wall.start_vertex_id];
    const end = document.vertices[wall.end_vertex_id];
    if (!start || !end) continue;
    if (start.x_mm === end.x_mm && start.y_mm === end.y_mm) {
      issues.push(createValidationIssue('WALL_ZERO_LENGTH', 'wall', wallId));
    }
  }

  // 重复墙
  const wallSet = new Set<string>();
  for (const [wallId, wall] of Object.entries(document.walls)) {
    const key = [wall.start_vertex_id, wall.end_vertex_id].sort().join('|');
    if (wallSet.has(key)) {
      issues.push(createValidationIssue('WALL_DUPLICATED', 'wall', wallId));
    }
    wallSet.add(key);
  }

  // 门窗越界
  for (const [elementId, element] of Object.entries(document.wall_elements)) {
    const hostWall = document.walls[element.host_wall_id];
    if (!hostWall) continue;
    const start = document.vertices[hostWall.start_vertex_id];
    const end = document.vertices[hostWall.end_vertex_id];
    if (!start || !end) continue;
    const wallLength = Math.hypot(end.x_mm - start.x_mm, end.y_mm - start.y_mm);
    if (
      element.offset_from_start_mm < 0 ||
      element.offset_from_start_mm + element.width_mm > wallLength
    ) {
      issues.push(
        createValidationIssue('OPENING_OUTSIDE_WALL', 'wall_element', elementId),
      );
    }
  }

  // 门窗重叠
  const byHost = new Map<string, Array<{ id: string; offset: number; width: number }>>();
  for (const [elementId, element] of Object.entries(document.wall_elements)) {
    const list = byHost.get(element.host_wall_id) ?? [];
    list.push({
      id: elementId,
      offset: element.offset_from_start_mm,
      width: element.width_mm,
    });
    byHost.set(element.host_wall_id, list);
  }
  for (const [, elements] of byHost) {
    elements.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < elements.length; i++) {
      if (elements[i].offset < elements[i - 1].offset + elements[i - 1].width) {
        issues.push(
          createValidationIssue('OPENING_OVERLAP', 'wall_element', elements[i].id),
        );
      }
    }
  }

  // 房间面积
  for (const [faceId, face] of Object.entries(document.faces)) {
    if (face.area_mm2 < 500_000) {
      // 0.5 m²
      issues.push(
        createValidationIssue('FACE_AREA_TOO_SMALL', 'face', faceId, {
          area_m2: (face.area_mm2 / 1_000_000).toFixed(2),
        }),
      );
    }
  }

  return issues;
}

function validateTopology(document: BuildingDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 未闭合面
  for (const [faceId, face] of Object.entries(document.faces)) {
    if (face.boundary_vertex_ids.length < 3) {
      issues.push(createValidationIssue('FACE_NOT_CLOSED', 'face', faceId));
    }
    const first = face.boundary_vertex_ids[0];
    const last = face.boundary_vertex_ids[face.boundary_vertex_ids.length - 1];
    if (first && last && first !== last) {
      issues.push(createValidationIssue('FACE_NOT_CLOSED', 'face', faceId));
    }
  }

  // 门窗宿主
  for (const [elementId, element] of Object.entries(document.wall_elements)) {
    if (!document.walls[element.host_wall_id]) {
      issues.push(
        createValidationIssue(
          'OPENING_WITHOUT_HOST_WALL',
          'wall_element',
          elementId,
        ),
      );
    }
  }

  return issues;
}

function validateSemantics(document: BuildingDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 未标注房间
  for (const [faceId, face] of Object.entries(document.faces)) {
    if (!face.function_code || face.function_code === 'unknown') {
      issues.push(
        createValidationIssue('FACE_FUNCTION_MISSING', 'face', faceId),
      );
    }
  }

  return issues;
}

function validateReference(document: BuildingDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!document.reference_calibration?.calibrated) {
    issues.push(createValidationIssue('REFERENCE_SCALE_MISSING', 'building'));
  }

  if (
    document.site.north_angle_deg === undefined ||
    document.site.north_angle_deg === null
  ) {
    issues.push(createValidationIssue('NORTH_ANGLE_MISSING', 'building'));
  }

  return issues;
}

/**
 * 检查是否存在严重错误（阻止完成）
 */
export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/**
 * 按类别筛选问题
 */
export function filterIssuesByCategory(
  issues: ValidationIssue[],
  category: ValidationCategory | 'all',
): ValidationIssue[] {
  if (category === 'all') return issues;
  return issues.filter((i) => i.category === category);
}

/**
 * 按严重程度筛选问题
 */
export function filterIssuesBySeverity(
  issues: ValidationIssue[],
  severity: ValidationSeverity | 'all',
): ValidationIssue[] {
  if (severity === 'all') return issues;
  return issues.filter((i) => i.severity === severity);
}

/**
 * 获取与指定实体关联的问题
 */
export function getIssuesForEntity(
  issues: ValidationIssue[],
  entityType: ValidationEntityType,
  entityId: string,
): ValidationIssue[] {
  return issues.filter(
    (i) => i.entity_type === entityType && i.entity_id === entityId,
  );
}
