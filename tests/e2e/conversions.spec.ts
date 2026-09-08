import { test, expect } from '@playwright/test';

test('single and mixed batch conversion share progress, path memory and folder action', async ({ page }) => {
  const projects = [
    { building_id: 'rural_001_house_0001', name: '住宅 1', status: 'complete', revision: 4, updated_at: '', preview_kind: 'empty' },
    { building_id: 'rural_001_house_0002', name: '住宅 2', status: 'draft', revision: 2, updated_at: '', preview_kind: 'empty' },
  ];
  const formats = ['graph', 'image', 'cad', 'embodied'].map((id, i) => ({ id, label: ['Graph', 'Image', 'CAD', 'Embodied'][i], directory: ['Graph', 'Image', 'CAD', 'Embodied'][i], version: '1', available: true }));
  const outputRoot = 'D:\\转换 结果';
  const requests: unknown[] = [];
  let opened = false;
  const items = formats.map((format, i) => ({ buildingId: projects[0].building_id, format: format.id, status: ['succeeded', 'skipped', 'failed', 'quarantined'][i], message: ['', '目录已存在', 'CAD 失败', '几何校验不通过'][i] }));
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
