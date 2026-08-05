import { Router } from 'express';
import type { RoomFunctionTemplateService } from '../roomFunctionTemplateService.js';

export function createSettingsRouter(
  service: RoomFunctionTemplateService,
): Router {
  const router = Router();

  router.get('/room-functions', async (_request, response) => {
    response.json(await service.list());
  });

  router.post('/room-functions', async (request, response) => {
    response.status(201).json(await service.create(request.body));
  });

  router.put('/room-functions/:code', async (request, response) => {
    response.json(await service.update(request.params.code, request.body));
  });

  router.delete('/room-functions/:code', async (request, response) => {
    await service.delete(request.params.code);
    response.json({ ok: true });
  });

  return router;
}

