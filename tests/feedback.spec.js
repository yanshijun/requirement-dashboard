const { test, expect } = require('@playwright/test');

test.describe('今日收集', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
    await page.click('.tab:has-text("今日收集")');
    await page.waitForSelector('.fb-board', { timeout: 15000 });
  });

  test('显示4个看板列', async ({ page }) => {
    await expect(page.locator('.fb-col')).toHaveCount(4);
  });

  test('列标题正确', async ({ page }) => {
    for (const label of ['待跟进', '跟进中', '已确认', '已关闭']) {
      await expect(page.locator('.fb-col-title').filter({ hasText: label })).toBeVisible();
    }
  });

  test('快速添加反馈', async ({ page }) => {
    const title = '自动化测试反馈_' + Date.now();
    await page.fill('#fbQuickTitle', title);
    await page.click('button:has-text("快速添加")');
    await page.waitForTimeout(1000);
    await expect(page.locator('.fb-card-title').filter({ hasText: title.substring(0, 10) })).toBeVisible();
  });

  test('打开详细填写弹窗', async ({ page }) => {
    await page.click('button:has-text("详细填写")');
    await expect(page.locator('#fbModal')).toBeVisible();
    await page.click('#fbModal .modal-close');
    await expect(page.locator('#fbModal')).not.toBeVisible();
  });

  test('点击卡片打开编辑弹窗', async ({ page }) => {
    const card = page.locator('.fb-card').first();
    const hasCard = await card.isVisible().catch(() => false);
    if (hasCard) {
      await card.click();
      await expect(page.locator('#fbModal')).toBeVisible();
      await page.click('#fbModal .modal-close');
    }
  });

  test('切回需求列表时隐藏工具栏再显示', async ({ page }) => {
    await expect(page.locator('.toolbar')).not.toBeVisible();
    await page.click('.tab:has-text("需求列表")');
    await page.waitForSelector('.stat-row', { timeout: 10000 });
    await expect(page.locator('.toolbar')).toBeVisible();
  });
});
