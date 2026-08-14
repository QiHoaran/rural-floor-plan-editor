import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { createEmptyBuilding } from '../src/editor/domain/buildingDocument.js';
import type { BuildingDocument } from '../src/editor/domain/buildingTypes.js';
import { prepareExportDocument } from '../src/editor/domain/exportUtils.js';
import { computeBuildingStatistics } from '../src/editor/domain/buildingStatistics.js';
import { validateBuildingDocumentFull } from '../src/editor/domain/buildingValidation.js';
import { generateSpatialGraph } from '../src/editor/domain/spatialGraph.js';
import { exportBuildingToGeoJson } from '../src/editor/domain/buildingGeoJson.js';
import { migrateToCurrent } from '../src/editor/domain/migrations/index.js';
import {
  createSurveyBuildingId,
  synchronizeClearHeight,
} from '../src/editor/domain/surveyData.js';
import type { HouseholdSurvey } from '../src/editor/domain/buildingTypes.js';
import { atomicWriteJson } from './atomicWrite.js';
import { ServiceError } from './errors.js';
import { renderPng } from './exportPng.js';
import { openLocalDirectory } from './openLocalDirectory.js';
import {
  renderBuildingSvg,
} from './renderBuildingSvg.js';
import {
  resolveBuildingDir,
  resolvePackageFile,
  validateBuildingId,
} from './pathSafety.js';
import {
  assertValidForOperation,
  validateForOperation,
  checkResearchExportRequirements,
} from './validationService.js';

export interface ExportOptions {
  scale?: string;
  scaleBar?: boolean;
}

export interface ProjectCommandInput {
  document: BuildingDocument;
  clientRevision: number;
}

export interface SubmittedExportInput extends ProjectCommandInput {
  options?: ExportOptions;
}

export interface SubmittedExportResult {
  zipPath: string;
  document: BuildingDocument;
}

const SCALE_PRESETS: Record<string, number> = {
  '1:500': 0.191,
  '1:200': 0.477,
  '1:100': 0.953,
  '1:50': 1.906,
};

const DEFAULT_PIXELS_PER_MM = 0.477; // 1:200

export interface CreateProjectInput {
  buildingId: string;
  wallThicknessMm?: number;
  image: ReferenceImageInput;
}

export interface ReferenceImageInput {
  bytes: Buffer;
  extension: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
}

export interface ProjectSummary {
  building_id: string;
  name: string;
  updated_at: string;
  status: string;
  revision: number;
  room_count: number;
  total_floor_area_m2: number;
  geometry_progress: number;
  room_semantic_progress: number;
  opening_progress: number;
  validation_error_count: number;
  validation_warning_count: number;
  preview_kind: 'empty' | 'reference' | 'vector';
  has_reference_image: boolean;
}

export type ProjectPreview =
  | { kind: 'empty' }
  | { kind: 'reference'; filePath: string; mimeType: string }
  | { kind: 'vector'; svg: string };

export interface RevisionEntry {
  revision: number;
  timestamp: string;
  status: string;
  notes?: string;
}

export interface BulkSurveyImportResult {
  created: string[];
  updated: string[];
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const REVISIONS_DIR = 'revisions';

export class ProjectService {
  private readonly projectQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly dataRoot: string,
    private readonly folderOpener: (directory: string) => Promise<void> = openLocalDirectory,
  ) {}

  /** 确保 data/ 和 data/.trash/ 目录存在，服务启动时调用 */
  async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.dataRoot, { recursive: true });
    await fs.mkdir(path.join(this.dataRoot, '.trash'), { recursive: true });
  }

  async create(input: CreateProjectInput): Promise<BuildingDocument> {
    const buildingId = validateBuildingId(input.buildingId);
    const buildingDir = resolveBuildingDir(this.dataRoot, buildingId);
    const extension = EXTENSION_BY_MIME[input.image.mimeType];
    if (!extension) {
      throw new ServiceError(
        '参考图片只支持 JPEG、PNG 或 WebP',
        400,
        'UNSUPPORTED_IMAGE',
      );
    }
    if (
      !Number.isInteger(input.image.widthPx) ||
      input.image.widthPx <= 0 ||
      !Number.isInteger(input.image.heightPx) ||
      input.image.heightPx <= 0
    ) {
      throw new ServiceError(
        '参考图片尺寸无效',
        400,
        'INVALID_IMAGE_DIMENSIONS',
      );
    }

    await fs.mkdir(this.dataRoot, { recursive: true });
    try {
      await fs.mkdir(buildingDir);
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new ServiceError(
          `建筑 ${buildingId} 已存在`,
          409,
          'BUILDING_EXISTS',
        );
      }
      throw error;
    }

    try {
      await Promise.all(
        ['reference', 'preview', 'draft', REVISIONS_DIR].map((name) =>
          fs.mkdir(path.join(buildingDir, name)),
        ),
      );

      const referencePath = `reference/original.${extension}`;
      const document = createEmptyBuilding(
        buildingId,
        referencePath,
        input.wallThicknessMm,
      );
      document.reference_image = {
        ...document.reference_image,
        mime_type: input.image.mimeType,
        width_px: input.image.widthPx,
        height_px: input.image.heightPx,
      };

      await fs.writeFile(
        path.join(buildingDir, 'reference', `original.${extension}`),
        input.image.bytes,
      );
      await atomicWriteJson(
        path.join(buildingDir, 'draft', 'building.autosave.json'),
        document,
      );

      return document;
    } catch (error) {
      await fs.rm(buildingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async attachReferenceImage(
    buildingId: string,
    image: ReferenceImageInput,
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    const extension = EXTENSION_BY_MIME[image.mimeType];
    if (!extension) {
      throw new ServiceError(
        '参考图片只支持 JPEG、PNG 或 WebP',
        400,
        'UNSUPPORTED_IMAGE',
      );
    }
    if (
      !Number.isInteger(image.widthPx) || image.widthPx <= 0 ||
      !Number.isInteger(image.heightPx) || image.heightPx <= 0
    ) {
      throw new ServiceError('参考图片尺寸无效', 400, 'INVALID_IMAGE_DIMENSIONS');
    }

    return this.withProjectLock(safeId, async () => {
      const current = (await this.open(safeId)).document;
      if (current.reference_image.path) {
        throw new ServiceError(
          '当前项目已有参考图，不能通过补图入口覆盖',
          409,
          'REFERENCE_ALREADY_EXISTS',
        );
      }
      const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
      const referencePath = `reference/original.${extension}`;
      await fs.writeFile(
        path.join(buildingDir, 'reference', `original.${extension}`),
        image.bytes,
      );
      const saved: BuildingDocument = {
        ...current,
        reference_image: {
          ...current.reference_image,
          path: referencePath,
          mime_type: image.mimeType,
          width_px: image.widthPx,
          height_px: image.heightPx,
        },
        metadata: {
          ...current.metadata,
          updated_at: new Date().toISOString(),
          revision: current.metadata.revision + 1,
        },
      };
      assertValidForOperation(saved, 'autosave');
      await atomicWriteJson(
        path.join(buildingDir, 'draft', 'building.autosave.json'),
        saved,
      );
      return saved;
    });
  }

  async removeReferenceImage(buildingId: string): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    return this.withProjectLock(safeId, async () => {
      const current = (await this.open(safeId)).document;
      if (!current.reference_image.path) {
        throw new ServiceError(
          '当前项目没有可删除的参考图',
          409,
          'REFERENCE_NOT_FOUND',
        );
      }

      const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
      const sourcePath = resolvePackageFile(
        this.dataRoot,
        safeId,
        current.reference_image.path,
      );
      const removedDir = path.join(buildingDir, 'reference', '.removed');
      await fs.mkdir(removedDir, { recursive: true });
      const removedPath = path.join(
        removedDir,
        `${Date.now()}-r${current.metadata.revision}-${path.basename(sourcePath)}`,
      );
      await fs.rename(sourcePath, removedPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          throw new ServiceError(
            '参考图文件不存在，未修改项目',
            404,
            'REFERENCE_FILE_NOT_FOUND',
          );
        }
        throw error;
      });

      const { reference_calibration: _calibration, ...withoutCalibration } = current;
      const saved: BuildingDocument = {
        ...withoutCalibration,
        reference_image: {
          path: '',
          mime_type: 'application/octet-stream',
          width_px: 0,
          height_px: 0,
          opacity: 0.55,
          transform: {
            translate_x_mm: 0,
            translate_y_mm: 0,
            scale: 1,
            rotation_deg: 0,
          },
        },
        metadata: {
          ...current.metadata,
          updated_at: new Date().toISOString(),
          revision: current.metadata.revision + 1,
        },
      };
      assertValidForOperation(saved, 'autosave');
      try {
        await atomicWriteJson(
          path.join(buildingDir, 'draft', 'building.autosave.json'),
          saved,
        );
      } catch (error) {
        await fs.rename(removedPath, sourcePath).catch(() => {});
        throw error;
      }
      return saved;
    });
  }

  async preview(buildingId: string): Promise<ProjectPreview> {
    const safeId = validateBuildingId(buildingId);
    const { document } = await this.open(safeId);
    if (Object.keys(document.walls ?? {}).length > 0) {
      return {
        kind: 'vector',
        svg: renderBuildingSvg(document, {
          pixelsPerMm: 0.1,
          includeScaleBar: false,
        }),
      };
    }
    if (document.reference_image.path) {
      return {
        kind: 'reference',
        filePath: this.resolveFile(safeId, document.reference_image.path),
        mimeType: document.reference_image.mime_type,
      };
    }
    return { kind: 'empty' };
  }

  async bulkImportSurveys(
    records: HouseholdSurvey[],
  ): Promise<BulkSurveyImportResult> {
    const result: BulkSurveyImportResult = { created: [], updated: [] };
    await this.ensureDirectories();

    for (const survey of records) {
      const buildingId = validateBuildingId(createSurveyBuildingId(survey));
      await this.withProjectLock(buildingId, async () => {
        const buildingDir = resolveBuildingDir(this.dataRoot, buildingId);
        let current: BuildingDocument | null = null;
        try {
          current = (await this.open(buildingId)).document;
        } catch (error) {
          if (!(error instanceof ServiceError) || error.code !== 'BUILDING_NOT_FOUND') {
            throw error;
          }
        }

        if (!current) {
          await fs.mkdir(buildingDir);
          try {
            await Promise.all(
              ['reference', 'preview', 'draft', REVISIONS_DIR].map((name) =>
                fs.mkdir(path.join(buildingDir, name)),
              ),
            );
            const document = applySurvey(
              createEmptyBuilding(buildingId, ''),
              survey,
              false,
            );
            await atomicWriteJson(
              path.join(buildingDir, 'draft', 'building.autosave.json'),
              document,
            );
            result.created.push(buildingId);
          } catch (error) {
            await fs.rm(buildingDir, { recursive: true, force: true });
            throw error;
          }
          return;
        }

        const updated = applySurvey(current, survey, true);
        assertValidForOperation(updated, 'autosave');
        await atomicWriteJson(
          path.join(buildingDir, 'draft', 'building.autosave.json'),
          updated,
        );
        result.updated.push(buildingId);
      });
    }

    return result;
  }

  async list(): Promise<ProjectSummary[]> {
    await fs.mkdir(this.dataRoot, { recursive: true });
    const entries = await fs.readdir(this.dataRoot, { withFileTypes: true });
    const projects: ProjectSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        const { document } = await this.open(entry.name);
        projects.push(summarizeDocument(document));
      } catch {
        // Ignore unrelated or incomplete directories in data/.
      }
    }

    return projects.sort((a, b) =>
      a.building_id.localeCompare(b.building_id),
    );
  }

  async listTrashed(): Promise<ProjectSummary[]> {
    const trashDir = path.join(this.dataRoot, '.trash');
    try {
      await fs.access(trashDir);
    } catch {
      return [];
    }
    const entries = await fs.readdir(trashDir, { withFileTypes: true });
    const projects: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const { document } = await this.openTrashed(entry.name);
        projects.push(summarizeDocument(document));
      } catch {
        // Ignore unreadable trashed directories.
      }
    }
    return projects.sort((a, b) =>
      a.building_id.localeCompare(b.building_id),
    );
  }

  async openFolder(buildingId: string): Promise<void> {
    const buildingDir = resolveBuildingDir(this.dataRoot, buildingId);
    let realRoot: string;
    let realBuildingDir: string;
    try {
      [realRoot, realBuildingDir] = await Promise.all([
        fs.realpath(this.dataRoot),
        fs.realpath(buildingDir),
      ]);
      const stat = await fs.stat(realBuildingDir);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new ServiceError(
        `建筑 ${buildingId} 不存在`,
        404,
        'BUILDING_NOT_FOUND',
      );
    }
    const relative = path.relative(realRoot, realBuildingDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ServiceError(
        '建筑目录超出了 data 目录边界',
        400,
        'INVALID_PROJECT_DIRECTORY',
      );
    }
    await this.folderOpener(realBuildingDir);
  }

  async trash(buildingId: string): Promise<void> {
    const safeId = validateBuildingId(buildingId);
    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    try {
      await fs.access(buildingDir);
    } catch {
      throw new ServiceError(
        `建筑 ${safeId} 不存在`,
        404,
        'BUILDING_NOT_FOUND',
      );
    }
    const trashDir = path.join(this.dataRoot, '.trash');
    await fs.mkdir(trashDir, { recursive: true });
    const target = path.join(trashDir, safeId);
    try {
      await fs.access(target);
      throw new ServiceError(
        `建筑 ${safeId} 已在回收站中`,
        409,
        'ALREADY_TRASHED',
      );
    } catch (error) {
      if (error instanceof ServiceError) throw error;
    }
    await fs.cp(buildingDir, target, { recursive: true });
    await fs.rm(buildingDir, { recursive: true, force: true });
  }

  async restore(buildingId: string): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    const trashDir = path.join(this.dataRoot, '.trash');
    const trashedDir = path.join(trashDir, safeId);
    try {
      await fs.access(trashedDir);
    } catch {
      throw new ServiceError(
        `建筑 ${safeId} 不在回收站中`,
        404,
        'NOT_IN_TRASH',
      );
    }
    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    try {
      await fs.access(buildingDir);
      throw new ServiceError(
        `建筑 ${safeId} 已存在`,
        409,
        'BUILDING_EXISTS',
      );
    } catch (error) {
      if (error instanceof ServiceError) throw error;
    }
    await fs.cp(trashedDir, buildingDir, { recursive: true });
    await fs.rm(trashedDir, { recursive: true, force: true });
    return (await this.open(safeId)).document;
  }

  private async openTrashed(
    buildingId: string,
  ): Promise<{ document: BuildingDocument; recovered_from_draft: boolean }> {
    const trashDir = path.join(this.dataRoot, '.trash');
    const trashedDir = path.join(trashDir, buildingId);
    const draftPath = path.join(trashedDir, 'draft', 'building.autosave.json');
    const finalPath = path.join(trashedDir, 'building.json');
    const [draft, final] = await Promise.all([
      readDocumentCandidate(draftPath),
      readDocumentCandidate(finalPath),
    ]);
    if (!draft && !final) {
      throw new ServiceError('无法读取建筑文档', 404, 'BUILDING_NOT_FOUND');
    }
    const result = draft && (!final || isDocumentNewer(draft, final))
      ? { document: draft, recovered_from_draft: Boolean(final) }
      : { document: final!, recovered_from_draft: false };

    // 迁移旧版本数据
    const migration = migrateToCurrent(result.document as unknown as Record<string, unknown>);
    return {
      document: migration.document,
      recovered_from_draft: result.recovered_from_draft || migration.warnings.length > 0,
    };
  }

  async open(
    buildingId: string,
  ): Promise<{
    document: BuildingDocument;
    recovered_from_draft: boolean;
    validation_warnings: string[];
  }> {
    const buildingDir = resolveBuildingDir(this.dataRoot, buildingId);
    const draftPath = path.join(
      buildingDir,
      'draft',
      'building.autosave.json',
    );
    const finalPath = path.join(buildingDir, 'building.json');
    const [draft, final] = await Promise.all([
      readDocumentCandidate(draftPath),
      readDocumentCandidate(finalPath),
    ]);

    if (!draft && !final) {
      throw new ServiceError(
        `建筑 ${buildingId} 不存在或没有可读取文档`,
        404,
        'BUILDING_NOT_FOUND',
      );
    }

    const result = draft && (!final || isDocumentNewer(draft, final))
      ? { document: draft, recovered_from_draft: Boolean(final) }
      : { document: final!, recovered_from_draft: false };

    // 迁移旧版本数据到当前 schema
    const migration = migrateToCurrent(result.document as unknown as Record<string, unknown>);
    const document = migration.document;

    // 打开时校验但不阻止 — 收集警告供调用方参考
    const validation = validateForOperation(document, 'open');
    const validation_warnings: string[] = [
      ...migration.warnings,
    ];
    if (!validation.schemaResult.valid) {
      validation_warnings.push(
        `Schema 校验未通过 (${validation.schemaResult.errors.length} 项)，数据可能不完整`,
      );
    }
    const businessErrors = validation.businessIssues.filter(
      (i) => i.severity === 'error',
    );
    if (businessErrors.length > 0) {
      validation_warnings.push(
        `业务校验错误 (${businessErrors.length} 项)：${businessErrors.map((e) => e.code).join(', ')}`,
      );
    }

    return {
      document,
      recovered_from_draft:
        result.recovered_from_draft || migration.warnings.length > 0,
      validation_warnings,
    };
  }

  // ============================================================
  // v2.1.0: 带 revision 乐观锁的自动保存
  // ============================================================

  async autosave(
    buildingId: string,
    document: BuildingDocument,
    clientRevision?: number,
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    return this.withProjectLock(safeId, () =>
      this.autosaveUnlocked(safeId, document, clientRevision),
    );
  }

  private async autosaveUnlocked(
    buildingId: string,
    document: BuildingDocument,
    clientRevision?: number,
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    if (document.building_id !== safeId) {
      throw new ServiceError(
        '请求路径中的建筑 ID 与文档不一致',
        409,
        'BUILDING_ID_MISMATCH',
      );
    }

    // Schema 校验 — 无效文档拒绝保存
    assertValidForOperation(document, 'autosave');

    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    try {
      await fs.access(buildingDir);
    } catch {
      throw new ServiceError(
        `建筑 ${safeId} 不存在`,
        404,
        'BUILDING_NOT_FOUND',
      );
    }

    // 乐观锁：检查 revision
    const current = await this.open(safeId);
    const serverRevision = current.document.metadata.revision;

    if (clientRevision !== undefined && clientRevision !== serverRevision) {
      throw new ServiceError(
        `版本冲突：客户端 revision ${clientRevision}，服务端 revision ${serverRevision}`,
        409,
        'REVISION_CONFLICT',
      );
    }

    const validated: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        status: current.document.metadata.status,
        updated_at: new Date().toISOString(),
        revision: serverRevision + 1,
      },
      workflow: structuredClone(current.document.workflow),
    };
    validated.structured_validation = validateBuildingDocumentFull(validated);
    validated.statistics = computeBuildingStatistics(validated);
    const saved = validated;

    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      saved,
    );
    return saved;
  }

  // ============================================================
  // v2.1.0: 工作流状态转换
  // ============================================================

  async submitReview(
    buildingId: string,
    input: ProjectCommandInput,
  ): Promise<BuildingDocument> {
    return this.executeWorkflowCommand(
      buildingId,
      input,
      'pending_review',
      'draft',
    );
  }

  async review(
    buildingId: string,
    input: ProjectCommandInput,
    reviewer?: string,
  ): Promise<BuildingDocument> {
    return this.executeWorkflowCommand(
      buildingId,
      input,
      'reviewed',
      'pending_review',
      reviewer,
    );
  }

  async complete(
    buildingId: string,
    input: ProjectCommandInput,
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    return this.withProjectLock(safeId, async () => {
    const current = await this.assertCommandInput(safeId, input);
    const document = input.document;

    // 强制检查：只能在 reviewed 或 draft 状态完成
    if (
      current.workflow.status !== 'reviewed' ||
      document.workflow.status !== 'reviewed'
    ) {
      throw new ServiceError(
        `当前状态 "${document.workflow.status}" 不允许直接完成，请先通过审核`,
        409,
        'INVALID_TRANSITION',
      );
    }

    // Schema + 业务校验 — 阻止有错误的文档完成
    assertValidForOperation(document, 'complete');
    this.assertResearchRequirements(document);

    const completed = prepareExportDocument({
      ...document,
      metadata: {
        ...document.metadata,
        status: 'complete',
        updated_at: new Date().toISOString(),
        revision: current.metadata.revision + 1,
      },
      workflow: {
        ...document.workflow,
        status: 'complete',
        completed_at: new Date().toISOString(),
      },
    });

    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);

    await this.saveRevision(safeId, completed, 'complete');
    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      completed,
    );
    // 保存正式版本
    await atomicWriteJson(
      path.join(buildingDir, 'building.json'),
      completed,
    );

    // 保存到 revisions
    return completed;
    });
  }

  async reopen(buildingId: string): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    return this.withProjectLock(safeId, async () => {
    const { document } = await this.open(safeId);

    if (document.workflow.status !== 'complete') {
      throw new ServiceError(
        `只有已完成的项目可以重新打开，当前状态为 "${document.workflow.status}"`,
        409,
        'INVALID_TRANSITION',
      );
    }

    const reopened: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        status: 'draft',
        updated_at: new Date().toISOString(),
        revision: document.metadata.revision + 1,
      },
      workflow: {
        ...document.workflow,
        status: 'draft',
        reviewer: undefined,
        reviewed_at: undefined,
        completed_at: undefined,
      },
    };

    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    await this.saveRevision(safeId, reopened, 'reopen');
    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      reopened,
    );
    await fs.unlink(path.join(buildingDir, 'building.json')).catch(() => {});

    return reopened;
    });
  }

  // ============================================================
  // v2.1.0: Revision 历史
  // ============================================================

  async listRevisions(buildingId: string): Promise<RevisionEntry[]> {
    const safeId = validateBuildingId(buildingId);
    const revDir = path.join(
      resolveBuildingDir(this.dataRoot, safeId),
      REVISIONS_DIR,
    );
    try {
      const files = await fs.readdir(revDir);
      const entries: RevisionEntry[] = [];
      for (const file of files) {
        const match = file.match(/^rev_(\d+)_.*\.json$/);
        if (!match) continue;
        try {
          const content = JSON.parse(
            await fs.readFile(path.join(revDir, file), 'utf8'),
          );
          entries.push({
            revision: Number(match[1]),
            timestamp: content.metadata?.updated_at ?? '',
            status: content.metadata?.status ?? 'unknown',
            notes: content.workflow?.completed_at
              ? `完成于 ${content.workflow.completed_at}`
              : undefined,
          });
        } catch {
          // skip unparseable
        }
      }
      return entries.sort((a, b) => b.revision - a.revision);
    } catch {
      return [];
    }
  }

  async getRevision(
    buildingId: string,
    revision: number,
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    const revDir = path.join(
      resolveBuildingDir(this.dataRoot, safeId),
      REVISIONS_DIR,
    );
    try {
      const files = await fs.readdir(revDir);
      for (const file of files) {
        const match = file.match(/^rev_(\d+)_.*\.json$/);
        if (!match || Number(match[1]) !== revision) continue;
        const content = JSON.parse(
          await fs.readFile(path.join(revDir, file), 'utf8'),
        );
        const migration = migrateToCurrent(content as Record<string, unknown>);
        return migration.document;
      }
    } catch {
      // fall through
    }
    throw new ServiceError(
      `Revision ${revision} 不存在`,
      404,
      'REVISION_NOT_FOUND',
    );
  }

  async restoreRevision(
    buildingId: string,
    revision: number,
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    return this.withProjectLock(safeId, async () => {
    const [document, current] = await Promise.all([
      this.getRevision(safeId, revision),
      this.open(safeId),
    ]);
    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    const restored: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        status: 'draft',
        updated_at: new Date().toISOString(),
        revision: current.document.metadata.revision + 1,
      },
      workflow: {
        ...document.workflow,
        status: 'draft',
        reviewer: undefined,
        reviewed_at: undefined,
        completed_at: undefined,
      },
    };
    await this.saveRevision(safeId, restored, 'restore');
    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      restored,
    );
    await fs.unlink(path.join(buildingDir, 'building.json')).catch(() => {});
    return restored;
    });
  }

  // ============================================================
  // 导出
  // ============================================================

  async exportSubmittedToZip(
    buildingId: string,
    input: SubmittedExportInput,
  ): Promise<SubmittedExportResult> {
    const safeId = validateBuildingId(buildingId);
    return this.withProjectLock(safeId, async () => {
      const current = await this.assertCommandInput(safeId, input);
      const submitted = input.document;
      assertValidForOperation(submitted, 'research_export');
      this.assertResearchRequirements(submitted);

      const changed = !sameDocumentContent(current, submitted);
      if (changed && current.workflow.status === 'complete') {
        throw new ServiceError(
          'Completed projects are read-only. Reopen before editing.',
          409,
          'PROJECT_READ_ONLY',
        );
      }

      const committed = changed
        ? prepareExportDocument({
            ...submitted,
            metadata: {
              ...submitted.metadata,
              status: current.metadata.status,
              updated_at: new Date().toISOString(),
              revision: current.metadata.revision + 1,
            },
            workflow: structuredClone(current.workflow),
          })
        : current;
      if (changed) {
        await atomicWriteJson(
          path.join(
            resolveBuildingDir(this.dataRoot, safeId),
            'draft',
            'building.autosave.json',
          ),
          committed,
        );
      }

      const zipPath = await this.exportToZip(safeId, input.options);
      return { zipPath, document: committed };
    });
  }

  async exportToZip(buildingId: string, options?: ExportOptions): Promise<string> {
    const safeId = validateBuildingId(buildingId);
    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    try {
      await fs.access(buildingDir);
    } catch {
      throw new ServiceError(
        `建筑 ${safeId} 不存在`,
        404,
        'BUILDING_NOT_FOUND',
      );
    }

    const exportDir = path.join(buildingDir, 'export');
    await fs.mkdir(exportDir, { recursive: true });

    // Read the current document to stamp metadata
    const { document } = await this.open(safeId);

    // Schema + 业务校验 — 无效文档拒绝导出
    assertValidForOperation(document, 'research_export');

    // research_export 额外检查
    const extraIssues = checkResearchExportRequirements(document);
    if (extraIssues.length > 0) {
      const issueMessages = extraIssues.map(
        (i) => `  ${i.field}: ${i.message}`,
      );
      throw new ServiceError(
        `研究级导出要求不满足：\n${issueMessages.join('\n')}`,
        422,
        'RESEARCH_EXPORT_REQUIREMENTS_NOT_MET',
        extraIssues,
      );
    }

    const finalDocument = prepareExportDocument(document);
    const spatialGraph = generateSpatialGraph(finalDocument);
    const buildingGeoJson = exportBuildingToGeoJson(finalDocument);

    // --- PNG 渲染 ---
    const pixelsPerMm = options?.scale && SCALE_PRESETS[options.scale]
      ? SCALE_PRESETS[options.scale]
      : DEFAULT_PIXELS_PER_MM;
    const includeScaleBar = options?.scaleBar === true;
    const svgString = renderBuildingSvg(finalDocument, {
      pixelsPerMm,
      includeScaleBar,
    });
    const pngBuffer = await renderPng(svgString);

    const zipPath = path.join(exportDir, `${safeId}.zip`);

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);

      // Add building.json
      archive.append(JSON.stringify(finalDocument, null, 2), {
        name: 'building.json',
      });
      archive.append(JSON.stringify(spatialGraph, null, 2), {
        name: 'spatial_graph.json',
      });
      archive.append(JSON.stringify(buildingGeoJson, null, 2), {
        name: 'building.geojson',
      });

      // Add floor plan PNG
      archive.append(pngBuffer, {
        name: 'floorplan.png',
      });

      // Add reference image if it exists
      const referencePath = path.join(
        buildingDir,
        finalDocument.reference_image.path,
      );
      archive.file(referencePath, {
        name: `reference.${path.extname(finalDocument.reference_image.path).slice(1)}`,
      });

      // Add metadata summary
      const metadata = {
        building_id: finalDocument.building_id,
        exported_at: finalDocument.metadata.updated_at,
        schema_version: finalDocument.schema_version,
        wall_count: Object.keys(finalDocument.walls).length,
        face_count: Object.keys(finalDocument.faces).length,
        element_count: Object.keys(finalDocument.wall_elements).length,
        status: finalDocument.workflow.status,
        revision: finalDocument.metadata.revision,
        validation_error_count:
          finalDocument.structured_validation?.filter(
            (issue) => issue.severity === 'error',
          ).length ?? 0,
        validation_warning_count:
          finalDocument.structured_validation?.filter(
            (issue) => issue.severity === 'warning',
          ).length ?? 0,
        files: [
          'building.json',
          'spatial_graph.json',
          'building.geojson',
          'floorplan.png',
          `reference.${path.extname(finalDocument.reference_image.path).slice(1)}`,
          'metadata.json',
        ],
        wall_thickness_mm: finalDocument.building_defaults.wall_thickness_mm,
        wall_height_mm: finalDocument.building_defaults.wall_height_mm,
      };
      archive.append(JSON.stringify(metadata, null, 2), {
        name: 'metadata.json',
      });

      archive.finalize();
    });

    return zipPath;
  }

  resolveFile(buildingId: string, relativePath: string): string {
    return resolvePackageFile(this.dataRoot, buildingId, relativePath);
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private async withProjectLock<T>(
    buildingId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.projectQueues.get(buildingId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.projectQueues.set(buildingId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.projectQueues.get(buildingId) === tail) {
        this.projectQueues.delete(buildingId);
      }
    }
  }

  private async assertCommandInput(
    buildingId: string,
    input: ProjectCommandInput,
  ): Promise<BuildingDocument> {
    if (!input?.document || !Number.isInteger(input.clientRevision)) {
      throw new ServiceError(
        'document and client_revision are required.',
        400,
        'INVALID_COMMAND',
      );
    }
    if (input.document.building_id !== buildingId) {
      throw new ServiceError(
        'Request building ID does not match document building ID.',
        409,
        'BUILDING_ID_MISMATCH',
      );
    }
    const current = (await this.open(buildingId)).document;
    if (input.clientRevision !== current.metadata.revision) {
      throw new ServiceError(
        `Revision conflict: client ${input.clientRevision}, server ${current.metadata.revision}.`,
        409,
        'REVISION_CONFLICT',
        {
          client_revision: input.clientRevision,
          server_revision: current.metadata.revision,
        },
      );
    }
    assertValidForOperation(input.document, 'autosave');
    return current;
  }

  private assertResearchRequirements(document: BuildingDocument): void {
    const issues = checkResearchExportRequirements(document);
    if (issues.length === 0) return;
    throw new ServiceError(
      'Research export requirements are not met.',
      422,
      'RESEARCH_EXPORT_REQUIREMENTS_NOT_MET',
      issues,
    );
  }

  private async executeWorkflowCommand(
    buildingId: string,
    input: ProjectCommandInput,
    targetStatus: BuildingDocument['workflow']['status'],
    allowedFrom: BuildingDocument['workflow']['status'],
    reviewer?: string,
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    return this.withProjectLock(safeId, async () => {
      const current = await this.assertCommandInput(safeId, input);
      if (
        current.workflow.status !== allowedFrom ||
        input.document.workflow.status !== allowedFrom
      ) {
        throw new ServiceError(
          `Status transition ${current.workflow.status} -> ${targetStatus} is not allowed.`,
          409,
          'INVALID_TRANSITION',
        );
      }
      const now = new Date().toISOString();
      const updated = prepareExportDocument({
        ...input.document,
        metadata: {
          ...input.document.metadata,
          status: targetStatus,
          revision: current.metadata.revision + 1,
          updated_at: now,
        },
        workflow: {
          ...input.document.workflow,
          status: targetStatus,
          ...(targetStatus === 'reviewed'
            ? { reviewer, reviewed_at: now }
            : {}),
        },
      });
      await atomicWriteJson(
        path.join(
          resolveBuildingDir(this.dataRoot, safeId),
          'draft',
          'building.autosave.json',
        ),
        updated,
      );
      return updated;
    });
  }

  private async transitionStatus(
    buildingId: string,
    targetStatus: BuildingDocument['workflow']['status'],
    allowedFrom: BuildingDocument['workflow']['status'][],
  ): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    const { document } = await this.open(safeId);
    const currentStatus = document.workflow?.status ?? document.metadata?.status ?? 'draft';

    if (!allowedFrom.includes(currentStatus as typeof allowedFrom[number])) {
      throw new ServiceError(
        `状态转换不允许：${currentStatus} → ${targetStatus}`,
        409,
        'INVALID_TRANSITION',
      );
    }

    const updated: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        status: targetStatus,
        updated_at: new Date().toISOString(),
        revision: document.metadata.revision + 1,
      },
      workflow: {
        ...document.workflow,
        status: targetStatus,
      },
    };

    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      updated,
    );

    return updated;
  }

  private async saveRevision(
    buildingId: string,
    document: BuildingDocument,
    _reason: string,
  ): Promise<void> {
    const revDir = path.join(
      resolveBuildingDir(this.dataRoot, buildingId),
      REVISIONS_DIR,
    );
    await fs.mkdir(revDir, { recursive: true });
    const filename = `rev_${document.metadata.revision}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await atomicWriteJson(path.join(revDir, filename), document);
  }
}

// ---- Helpers ----

function sameDocumentContent(
  left: BuildingDocument,
  right: BuildingDocument,
): boolean {
  const comparable = (document: BuildingDocument): unknown => {
    const clone = structuredClone(document);
    delete clone.statistics;
    delete clone.structured_validation;
    delete (clone.metadata as Partial<BuildingDocument['metadata']>).revision;
    delete (clone.metadata as Partial<BuildingDocument['metadata']>).updated_at;
    return sortJson(clone);
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

function summarizeDocument(document: BuildingDocument): ProjectSummary {
  const faces = Object.values(document.faces ?? {});
  const elements = Object.values(document.wall_elements ?? {});
  const issues = document.validation?.issues ?? [];
  const structuredIssues = document.structured_validation ?? [];

  const allIssues = [
    ...issues.map((i) => ({ severity: i.level, code: i.code })),
    ...structuredIssues.map((i) => ({ severity: i.severity, code: i.code })),
  ].filter((issue) => issue.code !== 'REFERENCE_SCALE_MISSING');

  const labeledFaces = faces.filter(
    (f) => f.function_code && f.function_code !== 'unknown',
  ).length;

  const totalArea =
    faces.reduce((sum, f) => sum + (f.area_mm2 ?? 0), 0) / 1_000_000;
  const hasVector = Object.keys(document.walls ?? {}).length > 0;
  const hasReferenceImage = Boolean(document.reference_image?.path);

  return {
    building_id: document.building_id,
    name: document.metadata?.name ?? document.building_id,
    updated_at: document.metadata?.updated_at ?? '',
    status: document.workflow?.status ?? document.metadata?.status ?? 'draft',
    revision: document.metadata?.revision ?? 0,
    room_count: faces.length,
    total_floor_area_m2: Math.round(totalArea * 100) / 100,
    geometry_progress: faces.length > 0 ? 100 : 0,
    room_semantic_progress:
      faces.length > 0 ? Math.round((labeledFaces / faces.length) * 100) : 0,
    opening_progress:
      elements.length > 0
        ? Math.round(
            (elements.filter((e) => e.status === 'valid').length /
              elements.length) *
              100,
          )
        : 100,
    validation_error_count: allIssues.filter(
      (i) => i.severity === 'error',
    ).length,
    validation_warning_count: allIssues.filter(
      (i) => i.severity === 'warning',
    ).length,
    preview_kind: hasVector
      ? 'vector'
      : hasReferenceImage
        ? 'reference'
        : 'empty',
    has_reference_image: hasReferenceImage,
  };
}

function applySurvey(
  document: BuildingDocument,
  survey: HouseholdSurvey,
  incrementRevision: boolean,
): BuildingDocument {
  const now = new Date().toISOString();
  return synchronizeClearHeight({
    ...document,
    survey: structuredClone(survey),
    metadata: {
      ...document.metadata,
      name: `村 ${survey.village_code} · 户 ${survey.household_code}`,
      village_code: survey.village_code,
      household_code: survey.household_code,
      updated_at: now,
      revision: document.metadata.revision + (incrementRevision ? 1 : 0),
    },
  });
}

async function readDocumentCandidate(
  filePath: string,
): Promise<BuildingDocument | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as BuildingDocument;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isDocumentNewer(
  left: BuildingDocument,
  right: BuildingDocument,
): boolean {
  const leftTime = Date.parse(left.metadata?.updated_at ?? '');
  const rightTime = Date.parse(right.metadata?.updated_at ?? '');
  if (leftTime !== rightTime) return leftTime > rightTime;
  return (left.metadata?.revision ?? 0) > (right.metadata?.revision ?? 0);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
