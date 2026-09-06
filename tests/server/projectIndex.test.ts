// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.ts';
import { ProjectService } from '../../server/projectService.ts';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';

let root: string;
let service: ProjectService;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'index-test-'));
  service = new ProjectService(root);
  await fs.mkdir(path.join(root, 'house_1'), { recursive: true });
  await fs.writeFile(path.join(root, 'house_1', 'building.json'), JSON.stringify(createEmptyBuilding('house_1', '')));
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

it('caches unchanged summaries but notices external changes', async () => {
  await service.list();
  const read = vi.spyOn(fs, 'readFile');
  await service.list();
  expect(read).not.toHaveBeenCalled();
  const doc = createEmptyBuilding('house_1', '');
  doc.metadata.name = 'changed externally';
  await fs.writeFile(path.join(root, 'house_1', 'building.json'), JSON.stringify(doc));
  expect((await service.list())[0].name).toBe('changed externally');
});

it('persists checks without changing revision and invalidates them on edits', async () => {
  const revision = (await service.list())[0].revision;
  const result = await service.checkProject('house_1', revision);
  expect(result.summary.check.status).not.toBe('unchecked');
  expect(result.summary.revision).toBe(revision);
  service = new ProjectService(root);
  expect((await service.list())[0].check.status).not.toBe('unchecked');
  const doc = createEmptyBuilding('house_1', '');
  doc.metadata.name = 'modified';
  await fs.writeFile(path.join(root, 'house_1', 'building.json'), JSON.stringify(doc));
  expect((await service.list())[0].check.status).toBe('unchecked');
});

it('failed automatic completion leaves workflow and revision unchanged', async () => {
  const before = (await service.open('house_1')).document;
  const result = await service.checkProject('house_1', before.metadata.revision, true);
  expect(result.outcome).toBe('failed');
  expect(result.summary.check.status).toBe('error');
  expect((await service.open('house_1')).document).toEqual(before);
  await expect(service.checkProject('house_1', 999, true)).rejects.toMatchObject({ status: 409 });
});

it('automatically completes eligible drafts, records its source, and skips repeats', async () => {
  const doc = createEmptyBuilding('house_1', '');
  doc.metadata.village_code = 'village_1';
  doc.site.location_name = 'Village';
  await fs.writeFile(path.join(root, 'house_1', 'building.json'), JSON.stringify(doc));
  const result = await service.checkProject('house_1', 0, true);
  expect(result.outcome).toBe('completed');
  expect(result.summary.status).toBe('complete');
  const saved = (await service.open('house_1')).document;
  expect(saved.workflow.reviewer).toBe('system:batch-auto-review');
  expect(saved.metadata.revision).toBe(1);
  expect((await service.checkProject('house_1', 1, true)).outcome).toBe('skipped');
});

it('notices draft changes, trash and restore without stale summaries', async () => {
  await service.list();
  const doc = createEmptyBuilding('house_1', '');
  doc.metadata.name = 'Newer draft';
  doc.metadata.updated_at = '2099-01-01T00:00:00.000Z';
  await fs.mkdir(path.join(root, 'house_1', 'draft'));
  await fs.writeFile(path.join(root, 'house_1', 'draft', 'building.autosave.json'), JSON.stringify(doc));
  expect((await service.list())[0].name).toBe('Newer draft');
  await service.trash('house_1');
  expect(await service.list()).toEqual([]);
  await service.restore('house_1');
  expect((await service.list())[0].name).toBe('Newer draft');
});

it('exposes version-checked HTTP operations and per-item failures', async () => {
  const app = await createApp({ projectRoot: root, dataRoot: root, port: 0, development: false });
  await request(app).post('/api/projects/house_1/check').send({}).expect(400);
  await request(app).post('/api/projects/house_1/check').send({ clientRevision: 9 }).expect(409);
  const checked = await request(app).post('/api/projects/house_1/check').send({ clientRevision: 0 }).expect(200);
  expect(checked.body.summary.check.revision).toBe(0);
  const completed = await request(app).post('/api/projects/house_1/auto-complete').send({ clientRevision: 0 }).expect(200);
  expect(completed.body.outcome).toBe('failed');
  await request(app).post('/api/projects/missing/check').send({ clientRevision: 0 }).expect(404);
});
