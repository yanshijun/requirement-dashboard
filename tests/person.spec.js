const { test, expect } = require('@playwright/test');

test.describe('人员任务', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
    await page.click('.tab:has-text("人员任务")');
    await page.waitForSelector('.person-grid', { timeout: 10000 });
  });

  test('显示人员卡片', async ({ page }) => {
    await expect(page.locator('.person-card')).not.toHaveCount(0);
  });

  test('卡片包含统计数字', async ({ page }) => {
    const card = page.locator('.person-card').first();
    await expect(card.locator('.pstat')).toHaveCount(4);
  });

  test('任务列表可滚动', async ({ page }) => {
    const card = page.locator('.person-card').first();
    const scrollBox = card.locator('div[style*="max-height:220px"]');
    await expect(scrollBox).toBeVisible();
  });

  test('显示进度条', async ({ page }) => {
    await expect(page.locator('.person-card .prog').first()).toBeVisible();
  });
});
