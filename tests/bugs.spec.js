const { test, expect } = require('@playwright/test');

// 创新项目 Bug 列表测试
// 跑法：
//   普通跑（后台无界面）       npx playwright test bugs
//   看到浏览器自动操作         HEADED=1 npx playwright test bugs
//   可视化面板逐步回放         npx playwright test bugs --ui
//   只看报告                  npx playwright show-report

test.describe('创新项目', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // 登录（如已登录则登录框不出现，跳过）
    const loginVisible = await page.locator('#loginPage textbox, #loginPage input').first().isVisible().catch(() => false);
    if (loginVisible) {
      await page.fill('#loginPage input[placeholder*="用户名"], #loginUser', 'admin');
      await page.fill('#loginPage input[type="password"], #loginPass', 'admin123');
      await page.click('button:has-text("登")');
    }
    // 切到创新项目 tab
    await page.click('text=🐛 创新项目');
    await page.waitForSelector('.bug-stats, #bugTableArea table', { timeout: 15000 });
  });

  test('页面加载，显示统计卡片和表格', async ({ page }) => {
    await expect(page.locator('.bug-stats')).toBeVisible();
    await expect(page.locator('#bugTableArea table')).toBeVisible();
  });

  test('表格有编号列和复选框列', async ({ page }) => {
    await expect(page.locator('#bugTableArea th:has-text("编号")')).toBeVisible();
    await expect(page.locator('#bugCheckAll')).toBeVisible();
  });

  test('点击行打开详情抽屉', async ({ page }) => {
    const firstRow = page.locator('#bugTableArea tbody tr').first();
    await firstRow.click();
    await expect(page.locator('#bugDrawer.open')).toBeVisible();
    await expect(page.locator('#bugDrawerBody')).toContainText('问题描述');
  });

  test('抽屉标题显示编号 No.', async ({ page }) => {
    await page.locator('#bugTableArea tbody tr').first().click();
    await expect(page.locator('.bug-drawer-title')).toContainText('No.');
  });

  test('关闭抽屉', async ({ page }) => {
    await page.locator('#bugTableArea tbody tr').first().click();
    await expect(page.locator('#bugDrawer.open')).toBeVisible();
    await page.click('#bugDrawer button:has-text("✕")');
    await expect(page.locator('#bugDrawer.open')).not.toBeVisible();
  });

  test('勾选复选框后导出按钮显示选中数量', async ({ page }) => {
    const firstCheckbox = page.locator('.bug-check-item').first();
    await firstCheckbox.check();
    await expect(page.locator('#bugExportBtn')).toContainText('导出选中');
  });

  test('全选框勾选所有行', async ({ page }) => {
    await page.locator('#bugCheckAll').check();
    const total = await page.locator('.bug-check-item').count();
    const checked = await page.locator('.bug-check-item:checked').count();
    expect(checked).toBe(total);
  });

  test('点击新增Bug打开弹窗', async ({ page }) => {
    await page.click('button:has-text("＋ 新增Bug")');
    await expect(page.locator('#bugModal')).toBeVisible();
    await expect(page.locator('#bugModalTitle')).toHaveText('新增 Bug');
  });

  test('复制按钮预填数据并标题带(副本)', async ({ page }) => {
    await page.locator('#bugTableArea tbody tr').first().locator('button:has-text("复制")').click();
    await expect(page.locator('#bugModal')).toBeVisible();
    await expect(page.locator('#bugModalTitle')).toHaveText('复制新增 Bug');
    const title = await page.locator('#bfTitle').inputValue();
    expect(title).toContain('(副本)');
  });

  test('搜索过滤', async ({ page }) => {
    await page.fill('#bugFSearch', '不存在的关键词xyz123');
    await page.waitForTimeout(400);
    await expect(page.locator('#bugTableArea')).toContainText(/暂无数据|共 0/);
  });
});
