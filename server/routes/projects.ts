import path from 'node:path';
import { Router } from 'express';
import type { BuildingDocument } from '../../src/editor/domain/buildingTypes.js';
import { parseSurveyText } from '../../src/editor/domain/surveyData.js';
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

  // ---- 项目列表与创建 ----

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

  // ---- 回收站 ----

  // NOTE: /trash must be registered before /:buildingId to avoid matching "trash" as an ID.
  router.get('/trash', async (_request, response) => {
    response.json(await projectService.listTrashed());
  });

  router.post('/surveys/bulk', async (request, response) => {
    const records = request.body?.records;
    if (!Array.isArray(records) || records.length === 0) {
      throw new ServiceError('请提供至少一条调查数据', 400, 'EMPTY_SURVEY_IMPORT');
    }
    if (records.length > 5000) {
      throw new ServiceError('单次最多导入 5000 条调查数据', 400, 'SURVEY_IMPORT_TOO_LARGE');
    }
    const parsed = parseSurveyText(JSON.stringify(records));
    if (parsed.issues.length > 0) {
      throw new ServiceError(
        `调查数据校验失败：第 ${parsed.issues[0].row} 条 ${parsed.issues[0].message}`,
        400,
        'INVALID_SURVEY_DATA',
      );
    }
    response.json(await projectService.bulkImportSurveys(parsed.records));
  });

  // ---- 文件服务 ----

  router.get(/^\/([^/]+)\/files\/(.+)$/, (request, response) => {
    const buildingId = request.params[0];
    const relativePath = request.params[1];
    response.sendFile(projectService.resolveFile(buildingId, relativePath));
  });

  // ---- 单个项目操作 ----

  router.get('/:buildingId', async (request, response) => {
    response.json(await projectService.open(request.params.buildingId));
  });

  router.post('/:buildingId/open-folder', async (request, response) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      throw new ServiceError(
        '打开本地文件夹仅允许从本机访问',
        403,
        'LOCAL_REQUEST_REQUIRED',
      );
    }
    await projectService.openFolder(request.params.buildingId);
    response.status(204).end();
  });

  router.post('/:buildingId/reference', async (request, response) => {
    const { image_name, image_mime, image_base64, width_px, height_px } = request.body ?? {};
    if (typeof image_mime !== 'string' || !SUPPORTED_IMAGE_MIMES.has(image_mime)) {
      throw new ServiceError('参考图片只支持 JPEG、PNG 或 WebP', 400, 'UNSUPPORTED_IMAGE');
    }
    if (typeof image_base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image_base64)) {
      throw new ServiceError('参考图片数据不是有效的 Base64', 400, 'INVALID_IMAGE_DATA');
    }
    const bytes = Buffer.from(image_base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new ServiceError('参考图片不能为空且不能超过 10 MB', 400, 'INVALID_IMAGE_SIZE');
    }
    response.json(await projectService.attachReferenceImage(
      request.params.buildingId,
      {
        bytes,
        extension: typeof image_name === 'string' ? path.extname(image_name).slice(1) : '',
        mimeType: image_mime,
        widthPx: Number(width_px),
        heightPx: Number(height_px),
      },
    ));
  });

  // ---- v2.1.0: 带 revision 锁的自动保存 ----

  router.put('/:buildingId/autosave', async (request, response) => {
    const body = request.body as BuildingDocument & { _clientRevision?: number };
    const clientRevision =
      typeof body._clientRevision === 'number'
        ? body._clientRevision
        : (body.metadata?.revision ?? undefined);
    const document = { ...body };
    delete document._clientRevision;

    const saved = await projectService.autosave(
      request.params.buildingId,
      document as BuildingDocument,
      clientRevision,
    );
    response.json(saved);
  });

  // ---- v2.1.0: 工作流状态转换 ----

  router.post('/:buildingId/submit-review', async (request, response) => {
    response.json(
      await projectService.submitReview(
        request.params.buildingId,
        commandInput(request.body),
      ),
    );
  });

  router.post('/:buildingId/review', async (request, response) => {
    const reviewer =
      typeof request.body?.reviewer === 'string'
        ? request.body.reviewer
        : undefined;
    response.json(
      await projectService.review(
        request.params.buildingId,
        commandInput(request.body),
        reviewer,
      ),
    );
  });

  router.post('/:buildingId/complete', async (request, response) => {
    response.json(
      await projectService.complete(
        request.params.buildingId,
        commandInput(request.body),
      ),
    );
  });

  router.post('/:buildingId/reopen', async (request, response) => {
    response.json(
      await projectService.reopen(request.params.buildingId),
    );
  });

  // ---- v2.1.0: Revision 历史 ----

  router.get('/:buildingId/revisions', async (request, response) => {
    response.json(
      await projectService.listRevisions(request.params.buildingId),
    );
  });

  router.get('/:buildingId/revisions/:revision', async (request, response) => {
    response.json(
      await projectService.getRevision(
        request.params.buildingId,
        Number(request.params.revision),
      ),
    );
  });

  router.post(
    '/:buildingId/revisions/:revision/restore',
    async (request, response) => {
      response.json(
        await projectService.restoreRevision(
          request.params.buildingId,
          Number(request.params.revision),
        ),
      );
    },
  );

  // ---- 删除与恢复 ----

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

  // ---- 导出 ----

  router.post('/:buildingId/export', async (request, response) => {
    const command = commandInput(request.body);
    const options = request.body?.options ?? {};
    const result = await projectService.exportSubmittedToZip(
      request.params.buildingId,
      {
        ...command,
        options: {
          scale:
            typeof options.scale === 'string' ? options.scale : undefined,
          scaleBar: options.scale_bar === true,
        },
      },
    );
    response.setHeader(
      'X-Building-Revision',
      String(result.document.metadata.revision),
    );
    response.download(result.zipPath, path.basename(result.zipPath));
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

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().split('%')[0];
  return normalized === '::1' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.');
}

function commandInput(body: unknown): {
  document: BuildingDocument;
  clientRevision: number;
} {
  const value = body as {
    document?: BuildingDocument;
    client_revision?: number;
  } | null;
  return {
    document: value?.document as BuildingDocument,
    clientRevision: value?.client_revision as number,
  };
}
