import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { createEmptyBuilding } from '../src/editor/domain/buildingDocument.js';
import type { BuildingDocument } from '../src/editor/domain/buildingTypes.js';
import { migrateToCurrent } from '../src/editor/domain/migrations/index.js';
import { atomicWriteJson } from './atomicWrite.js';
import { ServiceError } from './errors.js';
import { renderPng } from './exportPng.js';
import {
  renderBuildingSvg,
} from './renderBuildingSvg.js';
import {
  resolveBuildingDir,
  resolvePackageFile,
  validateBuildingId,
} from './pathSafety.js';

export interface ExportOptions {
  scale?: string;
  scaleBar?: boolean;
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
  image: {
    bytes: Buffer;
    extension: string;
    mimeType: string;
    widthPx: number;
    heightPx: number;
  };
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
}

export interface RevisionEntry {
  revision: number;
  timestamp: string;
  status: string;
  notes?: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const REVISIONS_DIR = 'revisions';

export class ProjectService {
  constructor(private readonly dataRoot: string) {}

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
  ): Promise<{ document: BuildingDocument; recovered_from_draft: boolean }> {
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
    return {
      document: migration.document,
      recovered_from_draft: result.recovered_from_draft || migration.warnings.length > 0,
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
    if (document.building_id !== safeId) {
      throw new ServiceError(
        '请求路径中的建筑 ID 与文档不一致',
        409,
        'BUILDING_ID_MISMATCH',
      );
    }

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

    const saved: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        updated_at: new Date().toISOString(),
        revision: serverRevision + 1,
      },
    };

    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      saved,
    );
    return saved;
  }

  // ============================================================
  // v2.1.0: 工作流状态转换
  // ============================================================

  async submitReview(buildingId: string): Promise<BuildingDocument> {
    return this.transitionStatus(buildingId, 'pending_review', ['draft']);
  }

  async review(buildingId: string, reviewer?: string): Promise<BuildingDocument> {
    const doc = await this.transitionStatus(buildingId, 'reviewed', ['pending_review']);
    doc.workflow = {
      ...doc.workflow,
      reviewer: reviewer ?? doc.workflow.reviewer,
      reviewed_at: new Date().toISOString(),
    };
    return doc;
  }

  async complete(buildingId: string): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
    const { document } = await this.open(safeId);

    // 强制检查：只能在 reviewed 状态完成
    if (document.workflow.status !== 'reviewed' && document.workflow.status !== 'draft') {
      throw new ServiceError(
        `当前状态 "${document.workflow.status}" 不允许直接完成，请先通过审核`,
        409,
        'INVALID_TRANSITION',
      );
    }

    // 运行校验（简化版：检查是否有错误）
    const issues = document.validation.issues ?? [];
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length > 0) {
      throw new ServiceError(
        `存在 ${errors.length} 个错误，无法完成项目`,
        409,
        'VALIDATION_ERRORS',
      );
    }

    const completed: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        status: 'complete',
        updated_at: new Date().toISOString(),
        revision: document.metadata.revision + 1,
      },
      workflow: {
        ...document.workflow,
        status: 'complete',
        completed_at: new Date().toISOString(),
      },
    };

    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);

    // 保存正式版本
    await atomicWriteJson(
      path.join(buildingDir, 'building.json'),
      completed,
    );

    // 保存到 revisions
    await this.saveRevision(safeId, completed, 'complete');

    return completed;
  }

  async reopen(buildingId: string): Promise<BuildingDocument> {
    const safeId = validateBuildingId(buildingId);
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
    await fs.unlink(path.join(buildingDir, 'building.json')).catch(() => {});
    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      reopened,
    );

    return reopened;
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
    const document = await this.getRevision(buildingId, revision);
    const safeId = validateBuildingId(buildingId);
    const buildingDir = resolveBuildingDir(this.dataRoot, safeId);
    const restored: BuildingDocument = {
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
      },
    };
    await fs.unlink(path.join(buildingDir, 'building.json')).catch(() => {});
    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      restored,
    );
    return restored;
  }

  // ============================================================
  // 导出
  // ============================================================

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
    const finalDocument: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        updated_at: new Date().toISOString(),
      },
    };

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

function summarizeDocument(document: BuildingDocument): ProjectSummary {
  const faces = Object.values(document.faces ?? {});
  const elements = Object.values(document.wall_elements ?? {});
  const issues = document.validation?.issues ?? [];
  const structuredIssues = document.structured_validation ?? [];

  const allIssues = [
    ...issues.map((i) => ({ severity: i.level })),
    ...structuredIssues.map((i) => ({ severity: i.severity })),
  ];

  const labeledFaces = faces.filter(
    (f) => f.function_code && f.function_code !== 'unknown',
  ).length;

  const totalArea =
    faces.reduce((sum, f) => sum + (f.area_mm2 ?? 0), 0) / 1_000_000;

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
  };
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
