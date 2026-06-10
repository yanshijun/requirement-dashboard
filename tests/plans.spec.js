const { test, expect } = require('@playwright/test');

// 计划列表服务端持久化（替代浏览器 localStorage）
// 验证：服务端加的计划，刷新/清缓存后依然在 —— 证明不依赖浏览器缓存

async function login(page) {
  await page.goto('/');
  const loginVisible = await page.locator('#loginPage input').first().isVisible().catch(() => false);
  if (loginVisible) {
    await page.fill('#loginPage input[placeholder*="用户名"], #loginUser', 'admin');
    await page.fill('#loginPage input[type="password"], #loginPass', 'admin123');
    await page.click('button:has-text("登")');
  }
  await page.waitForSelector('.stat-row', { timeout: 15000 });
}

test.describe('计划列表服务端持久化', () => {
  const PLAN = '持久化测试_' + Date.now();

  test.afterAll(async ({ request }) => {
    await request.post('/api/plans?action=delete', { data: { name: PLAN } });
  });

  test('服务端新增的计划出现在需求列表筛选与 Bug 清单', async ({ page, request }) => {
    await request.post('/api/plans?action=add', { data: { name: PLAN } });
    await login(page);
    // 需求列表顶部「全部计划」筛选包含该计划
    expect(await page.locator('#fPlan option').allTextContents()).toContain(PLAN);
    // Bug 清单新增弹窗「所属计划」下拉也包含
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });
    await page.click('button:has-text("＋ 新增Bug")');
    expect(await page.locator('#bfProduct option').allTextContents()).toContain(PLAN);
  });

  test('清空 localStorage 后计划依然在（不依赖浏览器缓存）', async ({ page, request }) => {
    await request.post('/api/plans?action=add', { data: { name: PLAN } });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await login(page);
    expect(await page.locator('#fPlan option').allTextContents()).toContain(PLAN);
  });
});
