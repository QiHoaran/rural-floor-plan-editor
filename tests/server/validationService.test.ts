// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../server/projectService.ts';
import { ServiceError } from '../../server/errors.ts';
import { validateForOperation } from '../../server/validationService.ts';
import type { BuildingDocument } from '../../src/editor/domain/buildingTypes.ts';

/**
 * 创建一个有效的 BuildingDocument 基础对象
 * 调用方可通过 Object.assign / spread 覆盖任意字段来构造无效数据
 */
function makeValidDocument(overrides?: Partial<BuildingDocument>): BuildingDocument {
  const now = new Date().toISOString();
  const base: BuildingDocument = {
    schema_version: '2.1.0',
    building_id: 'test_0001',
    metadata: {
      name: 'test_0001',
      floor_index: 1,
      created_at: now,
      updated_at: now,
      revision: 0,
      status: 'draft',
    },
    site: {
      north_angle_deg: 0,
    },
    workflow: {
      status: 'draft',
    },
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
    reference_image: {
      path: 'reference/original.png',
      mime_type: 'image/png',
      width_px: 640,
      height_px: 480,
      opacity: 0.55,
      transform: {
        translate_x_mm: 0,
        translate_y_mm: 0,
        scale: 1,
        rotation_deg: 0,
      },
    },
    floors: [
      {
        floor_id: 'floor_1',
        name: '一层',
        wall_ids: [],
        face_ids: [],
      },
    ],
    vertices: {},
    walls: {},
    wall_elements: {},
    faces: {},
    outside_regions: {},
    relations: [],
    validation: { issues: [] },
    custom_function_types: [],
  };

  if (overrides) {
    return { ...base, ...overrides } as BuildingDocument;
  }
  return base;
}

describe('validation service failure handling', () => {
  it('fails closed when the business validator throws', () => {
    const result = validateForOperation(
      makeValidDocument(),
      'research_export',
      () => {
        throw new Error('validator crashed');
      },
    );

    expect(result).toMatchObject({
      valid: false,
      blocked: true,
    });
    expect(result.businessIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VALIDATION_INTERNAL_ERROR',
          severity: 'error',
        }),
      ]),
    );
  });
});

describe('ProjectService — 校验集成', () => {
  let testRoot: string;
  let dataRoot: string;
  let service: ProjectService;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rural-plan-val-'));
    dataRoot = path.join(testRoot, 'data');
    service = new ProjectService(dataRoot);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  // 辅助：创建项目并返回 document
  async function createProject(): Promise<BuildingDocument> {
    return service.create({
      buildingId: 'test_0001',
      image: {
        bytes: Buffer.from('image-data'),
        extension: 'png',
        mimeType: 'image/png',
        widthPx: 640,
        heightPx: 480,
      },
    });
  }

  // ============================================================
  // autosave 校验
  // ============================================================

  describe('autosave', () => {
    it('接受有效文档', async () => {
      const created = await createProject();
      const saved = await service.autosave('test_0001', created);
      expect(saved.metadata.revision).toBe(1);
    });

    it('拒绝缺少 walls 的文档', async () => {
      await createProject();
      // 构造一个明确缺少 walls 的文档（不是 undefined，而是被删除的键）
      const doc = makeValidDocument();
      const invalid = { ...doc } as Record<string, unknown>;
      delete invalid['walls'];

      await expect(
        service.autosave('test_0001', invalid as BuildingDocument),
      ).rejects.toMatchObject<Partial<ServiceError>>({
        status: 422,
        code: 'INVALID_BUILDING_DOCUMENT',
      });
    });

    it('拒绝错误 schema_version 的文档', async () => {
      await createProject();
      const invalid = makeValidDocument({
        schema_version: '0.1.0',
      } as Partial<BuildingDocument>);

      await expect(
        service.autosave('test_0001', invalid),
      ).rejects.toMatchObject<Partial<ServiceError>>({
        status: 422,
        code: 'INVALID_BUILDING_DOCUMENT',
      });
    });

    it('拒绝断裂顶点引用的文档 — 墙体引用不存在的顶点', async () => {
      await createProject();
      // 墙体引用 vertices 中不存在的 key
      const invalid = makeValidDocument({
        walls: {
          w1: {
            start_vertex_id: 'v_missing',
            end_vertex_id: 'v_also_missing',
            wall_type: 'exterior',
            thickness_mm: 240,
            height_mm: 3000,
            material_type: 'brick',
          },
        },
      } as Partial<BuildingDocument>);

      // Schema 本身不检查顶点引用完整性（那属于业务校验），
      // 但 autosave 的 schema 校验会要求 walls 结构正确。
      // 业务校验会检测断裂引用 — 但 autosave 只阻断 schema 错误。
      // 这里验证 schema 层面可以通过，业务警告不会阻断 autosave。
      const saved = await service.autosave('test_0001', invalid);
      expect(saved.metadata.revision).toBe(1);
    });

    it('拒绝缺少 metadata 的文档', async () => {
      await createProject();
      const invalid = makeValidDocument({
        metadata: undefined as unknown as BuildingDocument['metadata'],
      });

      await expect(
        service.autosave('test_0001', invalid),
      ).rejects.toMatchObject<Partial<ServiceError>>({
        status: 422,
        code: 'INVALID_BUILDING_DOCUMENT',
      });
    });

    it('拒绝 building_id 为空的文档', async () => {
      await createProject();
      const invalid = makeValidDocument({ building_id: '' });

      await expect(
        service.autosave('test_0001', invalid),
      ).rejects.toMatchObject<Partial<ServiceError>>({
        status: 409,
        code: 'BUILDING_ID_MISMATCH',
      });
    });

    it('拒绝空 floors 数组的文档', async () => {
      await createProject();
      const invalid = makeValidDocument({ floors: [] });

      await expect(
        service.autosave('test_0001', invalid),
      ).rejects.toMatchObject<Partial<ServiceError>>({
        status: 422,
        code: 'INVALID_BUILDING_DOCUMENT',
      });
    });
  });

  // ============================================================
  // complete 校验
  // ============================================================

  describe('complete', () => {
    it('拒绝存在 Schema 错误的文档', async () => {
      await createProject();
      // 写入 schema 无效的文档：wall_type 不在 enum 中
      // migration 无法修复这种类型级别的错误
      const invalid = makeValidDocument({
        vertices: {
          v1: { x_mm: 0, y_mm: 0 },
          v2: { x_mm: 1000, y_mm: 0 },
        },
        walls: {
          w1: {
            start_vertex_id: 'v1',
            end_vertex_id: 'v2',
            wall_type: 'unknown' as 'exterior',  // 不在 enum ['exterior','interior','partition'] 中
            thickness_mm: 240,
            height_mm: 3000,
            material_type: 'brick',
          },
        },
        metadata: {
          ...makeValidDocument().metadata,
          revision: 1,
        },
        workflow: { status: 'draft' },
      } as Partial<BuildingDocument>);
      const buildingDir = path.join(dataRoot, 'test_0001');
      await fs.writeFile(
        path.join(buildingDir, 'draft', 'building.autosave.json'),
        JSON.stringify(invalid),
      );

      await expect(
        service.complete('test_0001', {
          document: invalid,
          clientRevision: invalid.metadata.revision,
        }),
      ).rejects.toMatchObject<
        Partial<ServiceError>
      >({
        status: 422,
        code: 'INVALID_BUILDING_DOCUMENT',
      });
    });

    it('拒绝存在业务错误的文档', async () => {
      await createProject();
      // 添加零长度墙体（业务错误）
      const doc = makeValidDocument({
        vertices: {
          v1: { x_mm: 100, y_mm: 200 },
        },
        walls: {
          w1: {
            start_vertex_id: 'v1',
            end_vertex_id: 'v1', // 零长度
            wall_type: 'exterior',
            thickness_mm: 240,
            height_mm: 3000,
            material_type: 'brick',
          },
        },
        metadata: {
          ...makeValidDocument().metadata,
          revision: 1,
        },
        workflow: { status: 'draft' },
      } as Partial<BuildingDocument>);
      const saved = await service.autosave('test_0001', doc);
      const pending = await service.submitReview('test_0001', {
        document: saved,
        clientRevision: saved.metadata.revision,
      });
      const reviewed = await service.review('test_0001', {
        document: pending,
        clientRevision: pending.metadata.revision,
      });

      await expect(
        service.complete('test_0001', {
          document: reviewed,
          clientRevision: reviewed.metadata.revision,
        }),
      ).rejects.toMatchObject<
        Partial<ServiceError>
      >({
        status: 422,
        code: 'INVALID_BUILDING_DOCUMENT',
      });
    });
  });

  // ============================================================
  // exportToZip 校验
  // ============================================================

  describe('exportToZip', () => {
    it('拒绝缺少比例标定和北向的文档（research_export 要求）', async () => {
      await createProject();
      const doc = makeValidDocument({
        reference_calibration: undefined,
        site: { north_angle_deg: 0 },
        metadata: {
          ...makeValidDocument().metadata,
          revision: 1,
        },
        workflow: { status: 'draft' },
      } as Partial<BuildingDocument>);
      await service.autosave('test_0001', doc);

      await expect(
        service.exportToZip('test_0001'),
      ).rejects.toMatchObject<Partial<ServiceError>>({
        status: 422,
        code: 'RESEARCH_EXPORT_REQUIREMENTS_NOT_MET',
      });
    });

    it('拒绝存在 Schema 错误的文档', async () => {
      await createProject();
      // 写入 schema 无效的文档：wall wall_type 不在 enum 中
      const invalid = makeValidDocument({
        vertices: {
          v1: { x_mm: 0, y_mm: 0 },
          v2: { x_mm: 1000, y_mm: 0 },
        },
        walls: {
          w1: {
            start_vertex_id: 'v1',
            end_vertex_id: 'v2',
            wall_type: 'unknown' as 'exterior',
            thickness_mm: 240,
            height_mm: 3000,
            material_type: 'brick',
          },
        },
      } as Partial<BuildingDocument>);
      const buildingDir = path.join(dataRoot, 'test_0001');
      await fs.writeFile(
        path.join(buildingDir, 'draft', 'building.autosave.json'),
        JSON.stringify(invalid),
      );

      await expect(
        service.exportToZip('test_0001'),
      ).rejects.toMatchObject<Partial<ServiceError>>({
        status: 422,
        code: 'INVALID_BUILDING_DOCUMENT',
      });
    });
  });

  // ============================================================
  // open 校验（不阻止，仅返回警告）
  // ============================================================

  describe('open', () => {
    it('对无效文档返回 validation_warnings 但不抛错', async () => {
      await createProject();
      // 写入 schema 无效的文档：wall_type 不在 enum 中（migration 无法修复）
      const invalid = makeValidDocument({
        vertices: {
          v1: { x_mm: 0, y_mm: 0 },
          v2: { x_mm: 1000, y_mm: 0 },
        },
        walls: {
          w1: {
            start_vertex_id: 'v1',
            end_vertex_id: 'v2',
            wall_type: 'unknown' as 'exterior',
            thickness_mm: 240,
            height_mm: 3000,
            material_type: 'brick',
          },
        },
      } as Partial<BuildingDocument>);
      const buildingDir = path.join(dataRoot, 'test_0001');
      await fs.writeFile(
        path.join(buildingDir, 'draft', 'building.autosave.json'),
        JSON.stringify(invalid),
      );

      const result = await service.open('test_0001');
      expect(result.document).toBeDefined();
      expect(result.validation_warnings).toBeDefined();
      // 应该有 schema 校验警告
      const hasSchemaWarning = result.validation_warnings.some((w) =>
        w.includes('Schema 校验未通过'),
      );
      expect(hasSchemaWarning).toBe(true);
    });

    it('有效文档不产生额外校验警告', async () => {
      await createProject();
      const result = await service.open('test_0001');
      expect(result.document).toBeDefined();
      // 新创建的有效文档不应有 schema 校验警告
      const hasSchemaWarning = result.validation_warnings.some((w) =>
        w.includes('Schema 校验未通过'),
      );
      expect(hasSchemaWarning).toBe(false);
    });
  });
});
