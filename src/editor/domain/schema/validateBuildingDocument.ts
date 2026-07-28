// ============================================================
// BuildingDocument 运行时 Schema 校验 — 基于 AJV
//
// 在以下位置运行：
// 1. 打开项目时
// 2. 导入 JSON 时
// 3. 自动保存前
// 4. 服务端接收保存请求时
// 5. 项目完成前
// 6. 导出正式数据前
// ============================================================

import Ajv, { type ErrorObject } from 'ajv';
import type { BuildingDocument } from '../buildingTypes.ts';

// 浏览器端：通过 Vite raw import 加载 schema JSON
// 服务端：通过 fs 或直接 import JSON
let cachedSchema: object | null = null;
let cachedValidator: ReturnType<Ajv['compile']> | null = null;

export interface SchemaValidationError {
  path: string;
  keyword: string;
  message: string;
  params?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}

/**
 * 将 AJV ErrorObject 转为结构化错误
 */
function toStructuredError(e: ErrorObject): SchemaValidationError {
  return {
    path: e.instancePath || '/',
    keyword: e.keyword,
    message: e.message ?? '未知校验错误',
    params: e.params as Record<string, unknown> | undefined,
  };
}

/**
 * 加载并编译 schema 校验器
 */
function getValidator(): ReturnType<Ajv['compile']> {
  if (cachedValidator) return cachedValidator;

  if (!cachedSchema) {
    // 浏览器端：从已加载的模块获取
    throw new Error(
      'Schema 未加载。请先调用 loadSchema() 或 import schema JSON。',
    );
  }

  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false, // 允许 additionalProperties
    formats: {
      'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/,
    },
  });

  cachedValidator = ajv.compile(cachedSchema);
  return cachedValidator;
}

/**
 * 加载 Schema JSON（从对象或 JSON 字符串）
 */
export function loadSchema(schema: object): void {
  cachedSchema = schema;
  cachedValidator = null;
}

/**
 * 验证 BuildingDocument 是否符合 JSON Schema
 */
export function validateBuildingDocument(
  document: unknown,
): ValidationResult {
  try {
    const validator = getValidator();
    const valid = validator(document) as boolean;

    if (valid) {
      return { valid: true, errors: [] };
    }

    return {
      valid: false,
      errors: (validator.errors ?? []).map(toStructuredError),
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          path: '/',
          keyword: 'validation_exception',
          message: error instanceof Error ? error.message : '校验器内部错误',
        },
      ],
    };
  }
}

/**
 * 检查文档是否至少包含基本结构（快速检查，不使用 AJV）
 */
export function isValidBuildingShape(document: unknown): document is BuildingDocument {
  if (!document || typeof document !== 'object') return false;
  const d = document as Record<string, unknown>;
  return (
    typeof d.schema_version === 'string' &&
    typeof d.building_id === 'string' &&
    typeof d.metadata === 'object' &&
    d.metadata !== null &&
    typeof d.vertices === 'object' &&
    d.vertices !== null &&
    typeof d.walls === 'object' &&
    d.walls !== null
  );
}
