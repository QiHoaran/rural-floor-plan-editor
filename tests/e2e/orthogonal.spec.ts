import { test, expect } from '@playwright/test';

test('previews and saves axis repair, then refreshes the index filter', async ({ page, request }) => {
  const id = `orthogonal_${Date.now()}`;
  const response = await request.post('/api/projects', { data: {
    building_id: id, image_name: 'reference.png', image_mime: 'image/png',
    image_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', width_px: 1, height_px: 1,
  } });
  expect(response.ok()).toBe(true);
  const { document } = await (await request.get(`/api/projects/${id}`)).json();
  document.vertices = { a: { x_mm: 0, y_mm: 0 }, b: { x_mm: 4000, y_mm: 100 }, c: { x_mm: 4000, y_mm: 3000 } };
  const wall = { wall_type: 'exterior', thickness_mm: 240, height_mm: 2800, material_type: 'brick' };
  document.walls = { ab: { ...wall, start_vertex_id: 'a', end_vertex_id: 'b' }, bc: { ...wall, start_vertex_id: 'b', end_vertex_id: 'c' } };
  document.floors[0].wall_ids = ['ab', 'bc'];
  const saved = await request.put(`/api/projects/${id}/autosave`, { data: { ...document, _clientRevision: document.metadata.revision } });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto('/');
  await page.getByLabel('正交检查筛选').selectOption('nonorthogonal');
  const item = page.locator(`[data-building-id="${id}"]`);
  await item.getByRole('button').first().click();
  await page.getByRole('button', { name: '质量', exact: true }).click();
  await page.getByRole('button', { name: '正交修复 ab', exact: true }).first().click();
  await expect(page.getByLabel('正交修复画布预览')).toBeVisible();
  await expect(page.getByTestId('orthogonal-preview-after-bc')).toHaveAttribute('y1', '0');
  await page.getByLabel('固定端点').selectOption('end');
  await expect(page.getByTestId('orthogonal-preview-after-bc')).toHaveCount(0);
  await page.getByLabel('固定端点').selectOption('start');
  await page.screenshot({ path: 'node_modules/.cache/orthogonal-preview.png' });
  await page.getByRole('button', { name: '取消修复' }).click();
  await expect(page.getByTestId('orthogonal-preview-after-ab')).toHaveCount(0);
  await page.getByRole('button', { name: '正交修复 ab', exact: true }).first().click();
  await page.getByRole('button', { name: '应用修复' }).click();
  await expect(page.getByRole('button', { name: '正交修复 ab', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /返回/ }).click();
  await expect(page.getByLabel('正交检查筛选')).toHaveValue('nonorthogonal');
  await expect.poll(async () => {
    const projects = await (await request.get('/api/projects')).json();
    return projects.find((p: { building_id: string }) => p.building_id === id).non_axis_aligned_wall_count;
  }).toBe(0);
  await page.getByLabel('正交检查筛选').selectOption('orthogonal');
  await expect(item).toBeVisible();
  await page.getByLabel('正交检查筛选').selectOption('nonorthogonal');
  await expect(item).toHaveCount(0);
});
