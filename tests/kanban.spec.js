const { test, expect } = require('@playwright/test');

test.describe('开发看板', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
    await page.click('.tab:has-text("开发看板")');
    await page.waitForSelector('.kanban', { timeout: 10000 });
  });

  test('显示6个状态列', async ({ page }) => {
    await expect(page.locator('.k-col')).toHaveCount(6);
  });

  test('列标题正确', async ({ page }) => {
    const cols = ['待开始', '开发中', '联调中', '测试中', '已上线', '已暂缓'];
    for (const col of cols) {
      await expect(page.locator('.k-col-head').filter({ hasText: col })).toBeVisible();
    }
  });

  test('点击卡片打开详情', async ({ page }) => {
    const card = page.locator('.k-card').first();
    const hasCard = await card.isVisible().catch(() => false);
    if (hasCard) {
      await card.click();
      await expect(page.locator('#detailModal')).toBeVisible();
      await page.click('.modal-close');
      await expect(page.locator('#detailModal')).not.toBeVisible();
    }
  });

  test('从需求列表跳转后筛选生效', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
    // 点击"开发中"统计卡片
    await page.locator('.stat-card:has-text("开发中")').click();
    await page.waitForSelector('.kanban', { timeout: 10000 });
    // 筛选条件应为开发中
    await expect(page.locator('#fStatus')).toHaveValue('开发中');
  });

  test('切回需求列表重置筛选', async ({ page }) => {
    await page.click('.tab:has-text("需求列表")');
    await page.waitForSelector('.stat-row', { timeout: 10000 });
    await expect(page.locator('#fStatus')).toHaveValue('');
    await expect(page.locator('#fPlan')).toHaveValue('');
  });
});
