import { test, expect } from '@playwright/test';

test.describe('乡村住宅矢量编辑器 E2E 冒烟测试', () => {
  test('首页加载并显示基本元素', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('乡村住宅矢量编辑器');
  });

  test('新建建筑对话框可打开和关闭', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("新建建筑")');
    const dialog = page.locator('form[aria-label="新建建筑"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[aria-label="建筑 ID"]')).toBeVisible();
    await expect(dialog.locator('input[aria-label="默认墙厚（米）"]')).toHaveValue('0.240');

    // Close the dialog
    await page.click('button:has-text("取消")');
    await expect(dialog).not.toBeVisible();
  });

  test('新建建筑表单验证：空 ID 被拒绝', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("新建建筑")');
    await page.click('button:has-text("创建建筑")');
    await expect(page.locator('text=请输入建筑 ID')).toBeVisible();
  });

  test('新建建筑表单验证：无效墙厚被拒绝', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("新建建筑")');
    await page.fill('input[aria-label="建筑 ID"]', 'test_e2e');
    await page.setInputFiles('input[type="file"]', {
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await page.fill('input[aria-label="默认墙厚（米）"]', '0');
    await page.click('button:has-text("创建建筑")');
    await expect(page.locator('text=墙厚必须在 0.01')).toBeVisible();
  });

  test('编辑器可完成审核、完成和当前 revision 导出流程', async ({
    page,
    request,
  }) => {
    const buildingId = 'e2e_delivery';
    const createdResponse = await request.post('/api/projects', {
      data: {
        building_id: buildingId,
        image_name: 'reference.png',
        image_mime: 'image/png',
        image_base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        width_px: 1,
        height_px: 1,
      },
    });
    expect(createdResponse.ok()).toBe(true);
    const created = await createdResponse.json();
    const ready = {
      ...created,
      metadata: {
        ...created.metadata,
        village_code: 'e2e_village',
      },
      site: {
        north_angle_deg: 0,
        location_name: 'E2E Village',
      },
      reference_calibration: {
        calibrated: true,
        point_a_image: { x: 0, y: 0 },
        point_b_image: { x: 1, y: 0 },
        real_distance_mm: 1000,
        mm_per_image_pixel: 1000,
        calibrated_at: '2026-07-28T00:00:00.000Z',
      },
    };
    const savedResponse = await request.put(
      `/api/projects/${buildingId}/autosave`,
      {
        data: {
          ...ready,
          _clientRevision: ready.metadata.revision,
        },
      },
    );
    expect(savedResponse.ok()).toBe(true);

    await page.goto('/');
    await page
      .getByRole('button', { name: new RegExp(`^${buildingId}`) })
      .click();
    await page.getByRole('button', { name: /提交审核/ }).click();
    await expect(
      page.getByRole('button', { name: /审核通过/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: /审核通过/ }).click();
    await expect(
      page.getByRole('button', { name: /完成项目/ }),
    ).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /完成项目/ }).click();
    await expect(
      page.getByRole('button', { name: /重新打开/ }),
    ).toBeVisible();

    const exportResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/projects/${buildingId}/export`),
      { timeout: 5_000 },
    );
    await page.getByRole('button', { name: '导出建筑包' }).click();
    const exportResponse = await exportResponsePromise;
    expect(exportResponse.status()).toBe(200);
    expect(exportResponse.headers()['x-building-revision']).toBe('4');
  });
});
