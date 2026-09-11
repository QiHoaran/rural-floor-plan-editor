import { test, expect } from '@playwright/test';
import { applyBuildingTemplate } from '../../src/editor/domain/buildingTemplate.ts';

test('node visibility and shared room function deletion, recovery and promotion', async ({ page, request }) => {
  const id = `controls_${Date.now()}`;
  const name = `书房_${Date.now()}`;
  const created = await request.post('/api/projects', { data: {
    building_id: id, image_name: 'reference.png', image_mime: 'image/png',
    image_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', width_px: 800, height_px: 600,
  } });
  expect(created.ok()).toBe(true);
  const draft = await created.json();
  const result = applyBuildingTemplate(draft, { frontageMm: 4000, depthMm: 3000, roomCount: 1 });
  if (!result.ok) throw new Error(result.message);
  const doc = result.document;
  doc.reference_image.path = '';
  const faceId = Object.keys(doc.faces)[0];
  doc.custom_function_types = [{ code: 'custom_old', name, color: '#000000' }];
  doc.faces[faceId] = { ...doc.faces[faceId], function_code: 'custom_old', display_name: name, color: '#000000' };
  const canonicalResponse = await request.post('/api/settings/room-functions', { data: { name, color: '#aabbcc' } });
  const canonical = await canonicalResponse.json();
  expect((await request.put(`/api/projects/${id}/autosave`, { data: { ...doc, _clientRevision: doc.metadata.revision } })).ok()).toBe(true);
  await page.goto('/');
  await page.locator(`[data-building-id="${id}"]`).getByRole('button').first().click();
  const vertices = page.locator('[data-testid^="vertex-visual-"]');
  await expect(vertices).toHaveCount(4);
  await page.getByLabel('显示点', { exact: true }).uncheck();
  await expect(vertices).toHaveCount(0);
  const wallBox = await page.locator('[data-testid^="wall-polygon-"]').nth(2).boundingBox();
  if (!wallBox) throw new Error('Wall is not visible');
  await page.mouse.click(wallBox.x + wallBox.width / 2, wallBox.y + wallBox.height / 2);
  await expect(vertices).toHaveCount(2);
  await page.locator('[data-testid^="face-polygon-"]').first().click();
  await expect(vertices).toHaveCount(0);
  await page.getByRole('button', { name: '房间', exact: true }).click();
  await expect(page.locator('aside').getByRole('button', { name, exact: true })).toHaveCount(1);
  await expect(page.locator(`[data-testid="face-polygon-${faceId}"]`)).toHaveAttribute('fill', '#aabbcc');
  await page.getByRole('button', { name: `设为内置 ${name}` }).click();
  await expect(page.getByRole('button', { name: `删除模板 ${name}` })).toHaveCount(0);
  await page.getByRole('button', { name: `取消内置 ${name}` }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `删除模板 ${name}` }).click();
  await expect(page.locator('aside').getByRole('button', { name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await expect(page.getByRole('option', { name: `${name}（历史标注）` })).toHaveCount(1);
  await page.getByRole('button', { name: /返回/ }).click();
  await page.locator(`[data-building-id="${id}"]`).getByRole('button').first().click();
  await page.getByRole('button', { name: '房间', exact: true }).click();
  await expect(page.locator('aside').getByRole('button', { name, exact: true })).toHaveCount(1);
  await expect.poll(async () => {
    const opened = await (await request.get(`/api/projects/${id}`)).json();
    return opened.document.faces[faceId].color;
  }).toBe(canonical.color);
  await page.screenshot({ path: 'tests/test-results/editor-controls.png' });
});
