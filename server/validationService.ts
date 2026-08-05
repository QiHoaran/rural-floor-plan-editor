// ============================================================
// 统一校验服务 — 根据操作类型验证 BuildingDocument
//
// 在以下位置运行：
// 1. 打开项目时 (open)
// 2. 自动保存前 (autosave)
// 3. 项目完成前 (complete)
// 4. 导出正式数据前 (research_export)
// ============================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSchema,
  validateBuildingDocument,
  type ValidationResult,
} from '../src/editor/domain/schema/validateBuildingDocument.js';
import {
  createValidationIssue,
  validateBuildingDocumentFull,
  hasErrors,
} from '../src/editor/domain/buildingValidation.js';
import type {
  BuildingDocument,
  ValidationIssue,
} from '../src/editor/domain/buildingTypes.js';
import { ServiceError } from './errors.js';

// ---- 操作类型 ----

export type ValidationOperation =
  | 'open'
  | 'autosave'
  | 'complete'
  | 'research_export';

// ---- 结果类型 ----

export interface OperationValidationResult {
  /** 无任何错误（schema 通过 + 无业务 error） */
  valid: boolean;
  /** 是否应阻止当前操作 */
  blocked: boolean;
  /** JSON Schema 校验结果 */
  schemaResult: ValidationResult;
  /** 业务规则校验问题 */
  businessIssues: ValidationIssue[];
}

// ---- Schema 加载（服务端单次初始化） ----

let schemaLoaded = false;

function ensureSchemaLoaded(): void {
  if (schemaLoaded) return;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(
    __dirname,
    '../src/editor/domain/schema/buildingDocument.schema.json',
  );
  const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf8'));
  loadSchema(schemaJson);
  schemaLoaded = true;
}

// ---- 主校验函数 ----

/**
 * 根据操作类型校验 BuildingDocument
 *
 * 规则：
 * - open:          允许迁移，Schema 错误不阻止（仅记录）
 * - autosave:      Schema 错误阻止保存；业务警告允许保存
 * - complete:      Schema 错误 + 业务 error 阻止完成
 * - research_export: 比 complete 更严格，还必须有方向、空间功能和来源信息
 */
export function validateForOperation(
  document: BuildingDocument,
  operation: ValidationOperation,
  businessValidator: (
    candidate: BuildingDocument,
  ) => ValidationIssue[] = validateBuildingDocumentFull,
): OperationValidationResult {
  ensureSchemaLoaded();

  const schemaResult = validateBuildingDocument(document);

  // 业务校验仅对基本结构完整的文档运行，避免在 undefined 字段上崩溃
  let businessIssues: ValidationIssue[] = [];
  if (schemaResult.valid) {
    try {
      businessIssues = businessValidator(document);
    } catch (error) {
      businessIssues = [
        createValidationIssue(
          'VALIDATION_INTERNAL_ERROR',
          'building',
          document.building_id,
          {
            error:
              error instanceof Error ? error.message : 'Unknown validator error',
          },
        ),
      ];
      // 业务校验器内部异常 — 降级为 schema 通过但业务校验失败
    }
  }

  let blocked = false;

  switch (operation) {
    case 'open':
      // 打开时允许迁移修复，不因 Schema 错误阻止
      blocked = false;
      break;

    case 'autosave':
      // Schema 错误 → 拒绝保存；业务警告 → 允许
      blocked =
        !schemaResult.valid ||
        businessIssues.some(
          (issue) => issue.code === 'VALIDATION_INTERNAL_ERROR',
        );
      break;

    case 'complete':
      // Schema 错误或业务 error → 阻止完成
      blocked = !schemaResult.valid || hasErrors(businessIssues);
      break;

    case 'research_export':
      // 比 complete 更严格的基础检查；具体的 research_export
      // 额外要求由调用方决定是否强制执行
      blocked = !schemaResult.valid || hasErrors(businessIssues);
      break;
  }

  return {
    valid: schemaResult.valid && !hasErrors(businessIssues),
    blocked,
    schemaResult,
    businessIssues,
  };
}

// ---- 断言辅助 ----

/**
 * 校验文档，若操作被阻止则抛出 ServiceError(422)
 */
export function assertValidForOperation(
  document: BuildingDocument,
  operation: ValidationOperation,
): void {
  const result = validateForOperation(document, operation);
  if (!result.blocked) return;

  const messages: string[] = [];

  if (!result.schemaResult.valid) {
    messages.push('Schema 校验失败：');
    for (const e of result.schemaResult.errors) {
      messages.push(`  ${e.path}: ${e.message}`);
    }
  }

  const errors = result.businessIssues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    messages.push(`业务校验错误 (${errors.length} 项)：`);
    for (const e of errors) {
      messages.push(`  [${e.code}] ${e.message_key}`);
    }
  }

  const allErrors = [
    ...result.schemaResult.errors,
    ...errors.map((e) => ({
      path: e.entity_id ?? '/',
      keyword: e.code,
      message: e.message_key,
      params: e.message_params,
    })),
  ];

  throw new ServiceError(
    messages.join('\n'),
    422,
    'INVALID_BUILDING_DOCUMENT',
    allErrors,
  );
}

// ---- research_export 额外检查 ----

/**
 * 执行 research_export 所需的额外业务规则检查
 * 这些规则独立于 Schema 和基本业务校验
 */
export interface ResearchExportIssue {
  field: string;
  message: string;
}

export function checkResearchExportRequirements(
  document: BuildingDocument,
): ResearchExportIssue[] {
  const issues: ResearchExportIssue[] = [];

  // 必须有北向
  if (
    document.site.north_angle_deg === undefined ||
    document.site.north_angle_deg === null
  ) {
    issues.push({
      field: 'site.north_angle_deg',
      message: '未设置建筑朝向（北向）',
    });
  }

  // 所有房间必须有功能标注
  for (const [faceId, face] of Object.entries(document.faces)) {
    if (!face.function_code || face.function_code === 'unknown') {
      issues.push({
        field: `faces.${faceId}.function_code`,
        message: `房间 "${face.display_name || faceId}" 缺少功能标注`,
      });
    }
  }

  // 必须有场地位置信息
  if (!document.site.location_name && !document.metadata.village_code) {
    issues.push({
      field: 'site.location_name',
      message: '缺少场地位置信息（行政村或地点名称）',
    });
  }

  // 必须有来源信息（village_code 或 household_code）
  if (!document.metadata.village_code && !document.metadata.household_code) {
    issues.push({
      field: 'metadata.village_code',
      message: '缺少来源信息（行政村编码或户编码）',
    });
  }

  return issues;
}
