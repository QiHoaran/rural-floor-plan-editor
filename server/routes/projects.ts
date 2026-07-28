import path from 'node:path';
import { Router } from 'express';
import type { BuildingDocument } from '../../src/editor/domain/buildingTypes.js';
import { ServiceError } from '../errors.js';
import type { ProjectService } from '../projectService.js';

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function createProjectRouter(projectService: ProjectService): Router {
  const router = Router();

  router.get('/', async (_request, response) => {
    response.json(await projectService.list());
  });

  router.post('/', async (request, response) => {
    const {
      building_id,
      image_name,
      image_mime,
      image_base64,
      width_px,
      height_px,
      wall_thickness_mm,
    } = request.body ?? {};

    if (
      typeof image_mime !== 'string' ||
      !SUPPORTED_IMAGE_MIMES.has(image_mime)
    ) {
      throw new ServiceError(
        '参考图片只支持 JPEG、PNG 或 WebP',
        400,
        'UNSUPPORTED_IMAGE',
      );
    }
    if (
      typeof image_base64 !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(image_base64)
    ) {
      throw new ServiceError(
        '参考图片数据不是有效的 Base64',
        400,
        'INVALID_IMAGE_DATA',
      );
    }

    const bytes = Buffer.from(image_base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new ServiceError(
        '参考图片不能为空且不能超过 10 MB',
        400,
        'INVALID_IMAGE_SIZE',
      );
    }

    const document = await projectService.create({
      buildingId: String(building_id ?? ''),
      wallThicknessMm:
        typeof wall_thickness_mm === 'number' &&
        Number.isFinite(wall_thickness_mm) &&
        wall_thickness_mm > 0 &&
        Number.isSafeInteger(wall_thickness_mm)
          ? wall_thickness_mm
          : undefined,
      image: {
        bytes,
        extension:
          typeof image_name === 'string'
            ? path.extname(image_name).slice(1)
            : '',
        mimeType: image_mime,
        widthPx: Number(width_px),
        heightPx: Number(height_px),
      },
    });
    response.status(201).json(document);
  });

  router.get(/^\/([^/]+)\/files\/(.+)$/, (request, response) => {
    const buildingId = request.params[0];
    const relativePath = request.params[1];
    response.sendFile(projectService.resolveFile(buildingId, relativePath));
  });

  router.put('/:buildingId/autosave', async (request, response) => {
    const saved = await projectService.autosave(
      request.params.buildingId,
      request.body as BuildingDocument,
    );
    response.json(saved);
  });

  // NOTE: /trash must be registered before /:buildingId to avoid matching "trash" as an ID.
  router.get('/trash', async (_request, response) => {
    response.json(await projectService.listTrashed());
  });

  router.get('/:buildingId', async (request, response) => {
    response.json(await projectService.open(request.params.buildingId));
  });

  router.delete('/:buildingId', async (request, response) => {
    try {
      await projectService.trash(request.params.buildingId);
      response.json({ ok: true });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        `删除建筑失败：${error instanceof Error ? error.message : '未知错误'}`,
        500,
        'TRASH_FAILED',
      );
    }
  });

  router.post('/:buildingId/restore', async (request, response) => {
    response.status(201).json(
      await projectService.restore(request.params.buildingId),
    );
  });

  router.get('/:buildingId/export', async (request, response) => {
    const scale =
      typeof request.query.scale === 'string'
        ? request.query.scale
        : undefined;
    const scaleBar =
      request.query.scaleBar === 'true' ||
      request.query.scaleBar === '1';

    const zipPath = await projectService.exportToZip(
      request.params.buildingId,
      { scale, scaleBar },
    );
    const filename = path.basename(zipPath);
    response.download(zipPath, filename);
  });

  return router;
}
