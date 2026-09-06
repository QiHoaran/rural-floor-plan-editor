import { test, expect } from '@playwright/test';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument';

for (const mode of ['卡片', '列表']) {
  test(`${mode}: preserves anchor and filters after editing among 467 buildings`, async ({ page }) => {
    const projects = Array.from({ length: 467 }, (_, i) => ({ building_id: `house_${i + 1}`, name: `建筑 ${i + 1}`, status: 'draft', revision: 0, updated_at: '2026-09-06', preview_kind: 'empty', room_count: 0, room_semantic_progress: 0 }));
    await page.route('**/api/projects', route => route.fulfill({ json: projects }));
    await page.route('**/api/projects/house_300', route => route.fulfill({ json: { document: createEmptyBuilding('house_300', '') } }));
    await page.goto('/');
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(page.locator('[data-building-id]')).toHaveCount(467);
    const item = page.locator('[data-building-id="house_300"]');
    await item.scrollIntoViewIfNeeded();
    const before = (await item.boundingBox())!.y;
    await item.getByRole('button').first().click();
    await page.getByRole('button', { name: /返回/ }).click();
    await expect(item).toBeInViewport();
    await expect.poll(async () => Math.abs((await item.boundingBox())!.y - before)).toBeLessThan(4);
    await expect(page.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('搜索建筑').fill('house_30');
    await page.getByRole('button', { name: mode === '卡片' ? '列表' : '卡片', exact: true }).click();
    await expect(page.getByLabel('搜索建筑')).toHaveValue('house_30');
    await page.reload();
    await expect(page.getByLabel('搜索建筑')).toHaveValue('house_30');
    await page.screenshot({ path: `node_modules/.cache/index-${mode === '卡片' ? 'cards' : 'list'}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test('batch checks share error styling and selection across views, with bounded requests', async ({ page }) => {
  const projects = Array.from({ length: 9 }, (_, i) => ({ building_id: `house_${i}`, name: `house_${i}`, status: 'draft', revision: 0, updated_at: '', preview_kind: 'empty' }));
  await page.route('**/api/projects', route => route.fulfill({ json: projects }));
  let active = 0, maximum = 0;
  await page.route('**/api/projects/*/check', async route => {
    active++; maximum = Math.max(maximum, active);
    const id = route.request().url().split('/').at(-2)!;
    await new Promise(resolve => setTimeout(resolve, 50));
    active--;
    await route.fulfill({ json: { outcome: id === 'house_1' ? 'failed' : 'checked', summary: { ...projects.find(p => p.building_id === id), check: { status: id === 'house_1' ? 'error' : 'passed', issues: [{ severity: 'error', code: 'TEST', message: '拓扑错误' }] } } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '全选筛选结果' }).click();
  await page.getByRole('button', { name: '批量检查', exact: true }).click();
  await expect(page.getByText('处理结束：成功 8 栋，失败 1 栋，跳过 0 栋。')).toBeVisible();
  expect(maximum).toBeLessThanOrEqual(4);
  const failed = page.locator('[data-building-id="house_1"]');
  await expect(failed).toHaveAttribute('data-check-status', 'error');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(failed).toHaveCSS('background-color', 'rgb(255, 241, 242)');
  await page.getByRole('button', { name: '选中失败项' }).click();
  await expect(page.getByLabel('选择 house_1', { exact: true })).toBeChecked();
  await expect(page.getByLabel('选择 house_2', { exact: true })).not.toBeChecked();
});

test('keeps a returned building visible after background refresh changes sorting and filter membership', async ({ page }) => {
  const projects = Array.from({ length: 80 }, (_, i) => ({ building_id: `house_${i + 1}`, name: `建筑 ${i + 1}`, status: 'draft', revision: 0, updated_at: '2026-09-06', preview_kind: 'empty' }));
  let opened = false;
  await page.route('**/api/projects', async route => {
    if (opened) { await new Promise(resolve => setTimeout(resolve, 150)); projects[59].status = 'reviewed'; projects[59].updated_at = '2099-01-01'; }
    await route.fulfill({ json: projects });
  });
  await page.route('**/api/projects/house_60', route => { opened = true; return route.fulfill({ json: { document: createEmptyBuilding('house_60', '') } }); });
  await page.goto('/');
  await page.getByLabel('工作流筛选').selectOption('draft');
  await page.getByLabel('排序', { exact: true }).selectOption('updated');
  const item = page.locator('[data-building-id="house_60"]');
  await item.scrollIntoViewIfNeeded();
  await item.getByRole('button').first().click();
  await page.getByRole('button', { name: /返回/ }).click();
  await expect(page.getByText('刚编辑的建筑已不符合筛选，暂时保留，调整筛选后移除。')).toBeVisible();
  await expect(item).toBeInViewport();
});

test('saves pending edits before returning to the index', async ({ page, request }) => {
  const id = `return_save_${Date.now()}`;
  const response = await request.post('/api/projects', { data: {
    building_id: id, image_name: 'reference.png', image_mime: 'image/png',
    image_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', width_px: 1, height_px: 1,
  } });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  const item = page.locator(`[data-building-id="${id}"]`);
  await item.getByRole('button').first().click();
  await page.getByLabel('村号（rural）').fill('saved_before_return');
  await page.getByRole('button', { name: /返回/ }).click();
  await expect(item).toBeInViewport();
  const saved = await (await request.get(`/api/projects/${id}`)).json();
  expect(saved.document.survey.village_code).toBe('saved_before_return');
});
