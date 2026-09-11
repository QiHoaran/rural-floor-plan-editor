// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { ProjectService } from '../../server/projectService.ts';
import { createSurveyBuildingId } from '../../src/editor/domain/surveyData.ts';
let root: string;
let service: ProjectService;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'readonly-project-')); service = new ProjectService(root); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it('rejects autosave, image changes and survey import against persisted complete status', async () => {
  const survey = { village_code: 'test', household_code: '1' };
  const id = createSurveyBuildingId(survey);
  const doc = await service.create({ buildingId: id, image: { bytes: Buffer.from('image'), extension: 'png', mimeType: 'image/png', widthPx: 10, heightPx: 10 } });
  doc.workflow.status = 'complete'; doc.metadata.status = 'complete';
  const file = path.join(root, id, 'draft', 'building.autosave.json');
  await fs.writeFile(file, JSON.stringify(doc));
  const before = await fs.readFile(file, 'utf8');
  const forged = { ...doc, workflow: { status: 'draft' as const }, metadata: { ...doc.metadata, status: 'draft' as const } };
  await expect(service.autosave(id, forged)).rejects.toMatchObject({ code: 'PROJECT_READ_ONLY' });
  await expect(service.attachReferenceImage(id, { bytes: Buffer.from('image'), extension: 'png', mimeType: 'image/png', widthPx: 10, heightPx: 10 })).rejects.toMatchObject({ code: 'PROJECT_READ_ONLY' });
  await expect(service.removeReferenceImage(id)).rejects.toMatchObject({ code: 'PROJECT_READ_ONLY' });
  await expect(service.bulkImportSurveys([survey])).rejects.toMatchObject({ code: 'PROJECT_READ_ONLY' });
  expect(await fs.readFile(file, 'utf8')).toBe(before);
});
