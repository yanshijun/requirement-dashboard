const { test, expect } = require('@playwright/test');

test.describe('需求列表', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
  });

  test('页面加载正常，显示统计卡片', async ({ page }) => {
    await expect(page.locator('.stat-row')).toBeVisible();
    await expect(page.locator('.stat-card')).toHaveCount(8);
  });

  test('显示需求表格', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('thead')).toContainText('需求名称');
  });

  test('筛选 - 按状态筛选', async ({ page }) => {
    await page.selectOption('#fStatus', '开发中');
    await page.waitForTimeout(500);
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    if (count > 0) {
      await expect(rows.first().locator('.tag')).toContainText('开发中');
    }
  });

  test('筛选 - 关键词搜索', async ({ page }) => {
    const firstRowName = await page.locator('tbody tr:first-child td:nth-child(2)').textContent();
    if (firstRowName) {
      await page.fill('#fSearch', firstRowName.trim().substring(0, 4));
      await page.waitForTimeout(500);
      await expect(page.locator('tbody tr')).not.toHaveCount(0);
    }
  });

  test('优先级排序', async ({ page }) => {
    await page.click('th:has-text("优先级")');
    await page.waitForTimeout(300);
    await expect(page.locator('th:has-text("优先级")')).toContainText('↑');
    await page.click('th:has-text("优先级")');
    await expect(page.locator('th:has-text("优先级")')).toContainText('↓');
  });

  test('分页功能', async ({ page }) => {
    const pagination = page.locator('.pagination');
    const hasPagination = await pagination.isVisible().catch(() => false);
    if (hasPagination) {
      await expect(page.locator('.page-btn.active')).toContainText('1');
      const nextBtn = page.locator('.page-btn:has-text("下一页")');
      const isDisabled = await nextBtn.isDisabled();
      if (!isDisabled) {
        await nextBtn.click();
        await expect(page.locator('.page-btn.active')).not.toContainText('1');
      }
    }
  });

  test('点击状态统计卡片跳转开发看板', async ({ page }) => {
    await page.locator('.stat-card').nth(3).click(); // 开发中
    await page.waitForTimeout(500);
    await expect(page.locator('.tab.active')).toContainText('开发看板');
  });
});
