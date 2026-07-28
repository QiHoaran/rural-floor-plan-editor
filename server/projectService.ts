import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { createEmptyBuilding } from '../src/editor/domain/buildingDocument.js';
import type { BuildingDocument } from '../src/editor/domain/buildingTypes.js';
import { atomicWriteJson } from './atomicWrite.js';
import { ServiceError } from './errors.js';
import { renderPng } from './exportPng.js';
import {
  renderBuildingSvg,
  type RenderSvgOptions,
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
  updated_at: string;
  status: 'draft' | 'complete';
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
        ['reference', 'preview', 'draft'].map((name) =>
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
        projects.push({
          building_id: document.building_id,
          updated_at: document.metadata.updated_at,
          status: document.metadata.status,
        });
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
        projects.push({
          building_id: document.building_id,
          updated_at: document.metadata.updated_at,
          status: 'draft' as const,
        });
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
    if (draft && (!final || isDocumentNewer(draft, final))) {
      return { document: draft, recovered_from_draft: Boolean(final) };
    }
    return { document: final!, recovered_from_draft: false };
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

    if (draft && (!final || isDocumentNewer(draft, final))) {
      return {
        document: draft,
        recovered_from_draft: Boolean(final),
      };
    }

    return {
      document: final!,
      recovered_from_draft: false,
    };
  }

  async autosave(
    buildingId: string,
    document: BuildingDocument,
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

    const current = await this.open(safeId);
    const saved: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        updated_at: new Date().toISOString(),
        revision: current.document.metadata.revision + 1,
        status: 'draft',
      },
    };

    await atomicWriteJson(
      path.join(buildingDir, 'draft', 'building.autosave.json'),
      saved,
    );
    return saved;
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
    const finalDocument: BuildingDocument = {
      ...document,
      metadata: {
        ...document.metadata,
        updated_at: new Date().toISOString(),
        status: 'complete',
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
  const leftTime = Date.parse(left.metadata.updated_at);
  const rightTime = Date.parse(right.metadata.updated_at);
  if (leftTime !== rightTime) return leftTime > rightTime;
  return left.metadata.revision > right.metadata.revision;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
