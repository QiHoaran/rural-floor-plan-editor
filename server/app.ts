import path from 'node:path';
import express, {
  type ErrorRequestHandler,
  type Express,
} from 'express';
import { createServer as createViteServer } from 'vite';
import type { ServerConfig } from './config.js';
import { ServiceError } from './errors.js';
import { ProjectService } from './projectService.js';
import { createProjectRouter } from './routes/projects.js';
import { createSettingsRouter } from './routes/settings.js';
import { RoomFunctionTemplateService } from './roomFunctionTemplateService.js';
import { ConversionService } from './conversions/service.js';
import { createConversionRouter } from './routes/conversions.js';

export async function createApp(config: ServerConfig): Promise<Express> {
  const app = express();
  const projectService = new ProjectService(config.dataRoot, config.folderOpener);
  const templateService = new RoomFunctionTemplateService(config.dataRoot);
  await projectService.ensureDirectories();

  app.use(express.json({ limit: '15mb' }));
  app.use('/api/projects', createProjectRouter(projectService));
  app.use('/api/settings', createSettingsRouter(templateService));
  app.use('/api/conversions', createConversionRouter(new ConversionService(config, projectService)));

  if (config.development) {
    const vite = await createViteServer({
      root: config.projectRoot,
      appType: 'spa',
      server: { middlewareMode: true },
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(config.projectRoot, 'dist');
    app.use(express.static(distDir));
    app.get(/.*/, (_request, response) => {
      response.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof ServiceError) {
      const body: Record<string, unknown> = {
        error: {
          code: error.code,
          message: error.message,
        },
      };
      if (error.details !== undefined) {
        (body.error as Record<string, unknown>).details = error.details;
      }
      response.status(error.status).json(body);
      return;
    }

    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: '本地服务发生未预期错误',
      },
    });
  };
  app.use(errorHandler);

  return app;
}
