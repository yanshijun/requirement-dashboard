const { test, expect } = require('@playwright/test');

// 需求列表 → 🐛 Bug清单（独立数据，UI 与创新项目一致）
// 跑法：
//   普通跑           npx playwright test reqbugs
//   看浏览器操作      HEADED=1 npx playwright test reqbugs

async function login(page) {
  await page.goto('/');
  const loginVisible = await page.locator('#loginPage input').first().isVisible().catch(() => false);
  if (loginVisible) {
    await page.fill('#loginPage input[placeholder*="用户名"], #loginUser', 'admin');
    await page.fill('#loginPage input[type="password"], #loginPass', 'admin123');
    await page.click('button:has-text("登")');
  }
  // 等需求列表渲染
  await page.waitForSelector('.stat-row', { timeout: 15000 });
}

test.describe('需求列表 · 独立 Bug 清单', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('需求列表有「🐛 Bug清单」入口按钮', async ({ page }) => {
    await expect(page.locator('button:has-text("🐛 Bug清单")')).toBeVisible();
  });

  test('点入口打开 Bug 清单（含返回按钮、工具栏、表格）', async ({ page }) => {
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });
    await expect(page.locator('button:has-text("← 返回需求列表")')).toBeVisible();
    await expect(page.locator('#bugTableArea table')).toBeVisible();
    await expect(page.locator('#bugTableArea th:has-text("编号")')).toBeVisible();
    await expect(page.locator('#bugCheckAll')).toBeVisible();
  });

  test('返回按钮回到需求列表', async ({ page }) => {
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });
    await page.click('button:has-text("← 返回需求列表")');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
    await expect(page.locator('.stat-row')).toBeVisible();
    await expect(page.locator('#bugFSearch')).toHaveCount(0);
  });

  test('Bug 清单按「所属计划」分类（读自需求列表）', async ({ page }) => {
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });
    // 表头是「计划」而非「产品」
    await expect(page.locator('#bugTableArea th').filter({ hasText: /^计划$/ })).toBeVisible();
    // 筛选下拉是「全部计划」
    await expect(page.locator('#bugFProduct option').first()).toHaveText('全部计划');
    // 新增弹窗里是「所属计划」+ 计划选项
    await page.click('button:has-text("＋ 新增Bug")');
    await expect(page.locator('#bfProductLabel')).toHaveText('所属计划');
    const opts = await page.locator('#bfProduct option').allTextContents();
    expect(opts).toContain('SAE2.3.3');
  });

  test('新增一条 Bug 并出现在列表', async ({ page, request }) => {
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });
    await page.click('button:has-text("＋ 新增Bug")');
    await expect(page.locator('#bugModal')).toBeVisible();
    const title = '需求Bug自动化_' + Date.now();
    await page.selectOption('#bfProduct', 'SAE2.3.3');
    await page.fill('#bfTitle', title);
    await page.click('#bugModal button:has-text("保存")');
    await page.waitForTimeout(800);
    await expect(page.locator('#bugTableArea').getByText(title)).toBeVisible();
    // 清理：删除本次新增的记录
    const list = await (await request.get('/api/reqbugs?action=list')).json();
    const rec = list.find(r => r.title === title);
    if (rec) await request.post('/api/reqbugs?action=delete', { data: { id: rec.id } });
  });

  test('点击行打开详情抽屉', async ({ page, request }) => {
    const r = await (await request.post('/api/reqbugs?action=add', { data: { product: 'SAE2.3.3', title: 'seed详情_' + Date.now() } })).json();
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugTableArea tbody tr td.actions', { timeout: 15000 });
    await page.locator('#bugTableArea tbody tr').first().click();
    await expect(page.locator('#bugDrawer.open')).toBeVisible();
    await expect(page.locator('.bug-drawer-title')).toContainText('No.');
    if (r.id) await request.post('/api/reqbugs?action=delete', { data: { id: r.id } });
  });

  test('勾选后导出按钮显示选中数量', async ({ page, request }) => {
    const r = await (await request.post('/api/reqbugs?action=add', { data: { product: 'SAE2.3.3', title: 'seed勾选_' + Date.now() } })).json();
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('.bug-check-item', { timeout: 15000 });
    await page.locator('.bug-check-item').first().check();
    await expect(page.locator('#bugExportBtn')).toContainText('导出选中');
    if (r.id) await request.post('/api/reqbugs?action=delete', { data: { id: r.id } });
  });

  test('创新项目 Tab 不受影响（无返回按钮）', async ({ page }) => {
    // 先进需求 Bug 清单
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });
    // 再切到创新项目 tab
    await page.click('text=🐛 创新项目');
    await page.waitForSelector('#bugTableArea table', { timeout: 15000 });
    // 创新项目不应出现返回按钮
    await expect(page.locator('button:has-text("← 返回需求列表")')).toHaveCount(0);
  });
});
