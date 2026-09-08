import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument';

test('single and mixed batch conversion share progress, path memory and folder action', async ({ page }) => {
  const projects = [
    { building_id: 'rural_001_house_0001', name: '住宅 1', status: 'complete', revision: 4, updated_at: '', preview_kind: 'empty' },
    { building_id: 'rural_001_house_0002', name: '住宅 2', status: 'draft', revision: 2, updated_at: '', preview_kind: 'empty' },
  ];
  const formats = ['graph', 'image', 'cad', 'embodied', 'housegan'].map((id, i) => ({ id, label: ['Graph', 'Image', 'CAD', 'Embodied', 'HouseGAN'][i], directory: ['Graph', 'Image', 'CAD', 'Embodied', 'HouseGAN'][i], version: '1', available: true }));
  const outputRoot = 'D:\\转换 结果';
  const requests: unknown[] = [];
  let opened = false;
  const items = formats.map((format, i) => ({ buildingId: projects[0].building_id, format: format.id, status: ['succeeded', 'skipped', 'failed', 'quarantined', 'succeeded'][i], message: ['', '目录已存在', 'CAD 失败', '几何校验不通过', ''][i] }));
  await page.route('**/api/projects', route => route.fulfill({ json: projects }));
  await page.route('**/api/conversions/formats', route => route.fulfill({ json: { formats } }));
  await page.route('**/api/conversions', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { id: 'test-job', status: 'queued', outputRoot, items: items.map(item => ({ ...item, status: 'queued', message: '' })) } });
  });
  await page.route('**/api/conversions/test-job', route => route.fulfill({ json: { id: 'test-job', status: 'completed', outputRoot, items } }));
  await page.route('**/api/conversions/test-job/open', route => { opened = true; return route.fulfill({ status: 204 }); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '数据转换 rural_001_house_0002', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '数据转换 rural_001_house_0001', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '数据转换' });
  await expect(dialog.getByLabel('输出文件夹', { exact: true })).toHaveValue('');
  for (const format of formats) await expect(dialog.getByLabel(format.label, { exact: true })).toBeChecked();
  await dialog.getByLabel('输出文件夹', { exact: true }).fill(outputRoot);
  await dialog.getByRole('button', { name: '开始转换' }).click();
  await expect(dialog.getByText('已隔离：几何校验不通过')).toBeVisible();
  await expect(dialog.getByText('失败：CAD 失败')).toBeVisible();
  await dialog.getByRole('button', { name: '打开输出目录' }).click();
  await expect.poll(() => opened).toBe(true);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '全选筛选结果' }).click();
  await page.getByRole('button', { name: '批量转换', exact: true }).click();
  await expect(dialog.getByText('已选 2 栋，可转换 1 栋；跳过 1 栋未完成项目。')).toBeVisible();
  await expect(dialog.getByLabel('输出文件夹', { exact: true })).toHaveValue(outputRoot);
  await dialog.getByLabel('覆盖已有结果').check();
  await dialog.getByRole('button', { name: '开始转换' }).click();
  await expect(dialog.getByText('已跳过：目录已存在')).toBeVisible();
  expect(requests).toEqual([false, true].map(overwrite => ({ projects: [{ buildingId: projects[0].building_id, revision: 4 }], formats: formats.map(format => format.id), outputRoot, overwrite })));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});

test('HouseGAN selection publishes real Python artifacts', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const dataRoot = testInfo.config.webServer?.env?.RURAL_DATA_ROOT;
  if (!dataRoot) throw new Error('This test requires the isolated Playwright data root');
  const id = `housegan_${Date.now()}`;
  const sourceDir = path.join(dataRoot, id);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'housegan-e2e-'));
  const document = createEmptyBuilding(id, 'reference/original.png');
  document.metadata.status = 'complete'; document.workflow.status = 'complete';
  document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 4000, y_mm: 0 }, c: { x_mm: 4000, y_mm: 3000 }, d: { x_mm: 0, y_mm: 3000 } };
  for (const [wallId, start, end] of [['bottom', 'a', 'b'], ['right', 'b', 'c'], ['top', 'c', 'd'], ['left', 'd', 'a']]) {
    document.walls[wallId] = { start_vertex_id: start, end_vertex_id: end, wall_type: 'exterior', thickness_mm: 240, height_mm: 2800, material_type: 'brick' };
  }
  document.faces = { room: { boundary_vertex_ids: ['a', 'b', 'c', 'd'], area_mm2: 12000000, function_code: 'sunroom', display_name: '阳光房', color: '#F2C14E', local_name: '' } };
  document.wall_elements = { door: { element_type: 'exterior_door', host_wall_id: 'bottom', offset_from_start_mm: 1000, width_mm: 900, height_mm: 2100, sill_height_mm: 0, status: 'valid' } };
  document.relations = [{ relation_type: 'opening', wall_element_id: 'door', from_face_id: 'room', to: { kind: 'outside' }, channels: { people: true, air: true, light: true } }];
  document.floors[0].wall_ids = Object.keys(document.walls); document.floors[0].face_ids = ['room'];
  const original = JSON.stringify(document);
  try {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'building.json'), original);
    await page.goto('/');
    await page.getByRole('button', { name: `数据转换 ${id}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '数据转换' });
    await expect(dialog.getByLabel('HouseGAN', { exact: true })).toBeChecked({ timeout: 15000 });
    for (const label of ['Graph', 'Image', 'CAD', 'Embodied']) await dialog.getByLabel(label, { exact: true }).uncheck();
    await dialog.getByLabel('输出文件夹', { exact: true }).fill(outputRoot);
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/conversions') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '开始转换' }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    expect(response.request().postDataJSON().formats).toEqual(['housegan']);
    await expect(dialog.getByText('成功', { exact: true })).toBeVisible({ timeout: 20000 });
    const directory = path.join(outputRoot, id, 'HouseGAN');
    expect((await fs.readdir(directory)).sort()).toEqual(['conversion.json', 'housegan.json', 'housegan.schema.json', 'mapping.json', 'vocabulary.json']);
    const payload = JSON.parse(await fs.readFile(path.join(directory, 'housegan.json'), 'utf8'));
    expect(payload.room_type).toEqual([18, 15]);
    expect(await fs.readFile(path.join(sourceDir, 'building.json'), 'utf8')).toBe(original);
    await page.screenshot({ path: testInfo.outputPath('housegan-success.png') });
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
