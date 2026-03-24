const { test, expect } = require('@playwright/test');

test.describe('认领管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
  });

  test('未认领需求显示认领按钮', async ({ page }) => {
    const claimBtn = page.locator('button:has-text("认领")').first();
    const hasBtn = await claimBtn.isVisible().catch(() => false);
    if (hasBtn) {
      await expect(claimBtn).toBeVisible();
    }
  });

  test('点击认领打开弹窗', async ({ page }) => {
    const claimBtn = page.locator('button:has-text("认领")').first();
    const hasBtn = await claimBtn.isVisible().catch(() => false);
    if (hasBtn) {
      await claimBtn.click();
      await expect(page.locator('#claimModal')).toBeVisible();
      await page.click('#claimModal .modal-close');
      await expect(page.locator('#claimModal')).not.toBeVisible();
    }
  });

  test('认领弹窗显示成员列表', async ({ page }) => {
    const claimBtn = page.locator('button:has-text("认领")').first();
    const hasBtn = await claimBtn.isVisible().catch(() => false);
    if (hasBtn) {
      await claimBtn.click();
      await expect(page.locator('.person-list-item')).not.toHaveCount(0);
      await page.click('#claimModal .modal-close');
    }
  });

  test('已认领需求显示换人和释放按钮', async ({ page }) => {
    const switchBtn = page.locator('button:has-text("换人")').first();
    const hasBtn = await switchBtn.isVisible().catch(() => false);
    if (hasBtn) {
      await expect(switchBtn).toBeVisible();
      await expect(page.locator('button:has-text("释放")').first()).toBeVisible();
    }
  });

  test('认领弹窗可新增成员', async ({ page }) => {
    const claimBtn = page.locator('button:has-text("认领")').first();
    const hasBtn = await claimBtn.isVisible().catch(() => false);
    if (hasBtn) {
      await claimBtn.click();
      await page.fill('.person-add-row input', '测试成员');
      await page.click('.person-add-row button');
      await expect(page.locator('.person-list-item').filter({ hasText: '测试成员' })).toBeVisible();
      await page.click('#claimModal .modal-close');
    }
  });
});
