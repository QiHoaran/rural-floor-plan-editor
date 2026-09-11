// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { RoomFunctionTemplateService } from '../../server/roomFunctionTemplateService.ts';
let root: string;
let service: RoomFunctionTemplateService;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-functions-')); service = new RoomFunctionTemplateService(root); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it('reuses names regardless of case, whitespace and color', async () => {
  const first = await service.create({ name: 'Studio', color: '#112233' });
  expect(await service.create({ name: ' studio ', color: '#aabbcc' })).toEqual(first);
  expect(await service.list()).toHaveLength(1);
});
it('merges renamed entries into the existing target', async () => {
  const first = await service.create({ name: 'A', color: '#112233' });
  const second = await service.create({ name: 'B', color: '#aabbcc' });
  expect(await service.update(second.code, { name: 'A', color: '#000000' })).toEqual(first);
  expect(await service.list()).toEqual([first]);
});
it('protects built-ins and allows demotion of user built-ins', async () => {
  const item = await service.create({ name: 'Studio', color: '#112233' });
  await service.update(item.code, { name: item.name, color: item.color, is_builtin: true });
  await expect(service.delete(item.code)).rejects.toMatchObject({ code: 'ROOM_TEMPLATE_BUILT_IN' });
  expect((await service.list())[0].is_builtin).toBe(true);
  await service.update(item.code, { name: item.name, color: item.color, is_builtin: false });
  await service.delete(item.code);
  await expect(service.delete('bedroom')).rejects.toMatchObject({ code: 'ROOM_TEMPLATE_BUILT_IN' });
});
