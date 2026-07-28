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
    await page.fill('input[aria-label="默认墙厚（米）"]', '0');
    await page.click('button:has-text("创建建筑")');
    await expect(page.locator('text=墙厚必须在 0.01')).toBeVisible();
  });
});
