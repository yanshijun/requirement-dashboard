const { test, expect } = require('@playwright/test');

// 需求列表：状态多选筛选
async function login(page) {
  await page.goto('/');
  const needLogin = await page.locator('#loginPage input').first().isVisible().catch(() => false);
  if (needLogin) {
    await page.fill('#loginUser', 'admin');
    await page.fill('#loginPass', 'admin123');
    await page.click('button:has-text("登")');
  }
  await page.waitForSelector('.stat-row', { timeout: 15000 });
}

test.describe('需求列表 状态多选筛选', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('多选控件存在，点开有状态复选框', async ({ page }) => {
    await page.click('#fStatusBtn');
    await expect(page.locator('#fStatusPanel')).toHaveClass(/open/);
    await expect(page.locator('#fStatusPanel input[type=checkbox]')).toHaveCount(7);
    await expect(page.locator('#fStatusLabel')).toHaveText('全部状态');
  });

  test('勾选多个状态：只显示这些状态的需求', async ({ page }) => {
    await page.click('#fStatusBtn');
    await page.check('#fStatusPanel input[value="开发中"]');
    await page.check('#fStatusPanel input[value="测试中"]');
    // 按钮显示"已选状态" + 计数徽标 2
    await expect(page.locator('#fStatusLabel')).toHaveText('已选状态');
    await expect(page.locator('#fStatusBtn .ms-cnt')).toHaveText('2');
    // 关掉面板，检查表格里的状态标签只有"开发中"或"测试中"
    await page.click('#fStatusBtn');
    await page.waitForTimeout(300);
    const statuses = await page.locator('.parent-row td:nth-child(9)').allInnerTexts();
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) {
      expect(['开发中', '测试中']).toContain(s.trim());
    }
  });

  test('单选一个状态：等价于旧的单状态筛选', async ({ page }) => {
    await page.click('#fStatusBtn');
    await page.check('#fStatusPanel input[value="待开始"]');
    await expect(page.locator('#fStatusLabel')).toHaveText('待开始');
    await page.click('#fStatusBtn');
    await page.waitForTimeout(300);
    const statuses = await page.locator('.parent-row td:nth-child(9)').allInnerTexts();
    for (const s of statuses) expect(s.trim()).toBe('待开始');
  });

  test('清空按钮恢复全部状态', async ({ page }) => {
    await page.click('#fStatusBtn');
    await page.check('#fStatusPanel input[value="开发中"]');
    await page.click('#fStatusPanel .ms-clear');
    await expect(page.locator('#fStatusLabel')).toHaveText('全部状态');
    await expect(page.locator('#fStatusPanel input:checked')).toHaveCount(0);
  });

  test('点击面板外部会关闭', async ({ page }) => {
    await page.click('#fStatusBtn');
    await expect(page.locator('#fStatusPanel')).toHaveClass(/open/);
    await page.click('#fSearch');
    await expect(page.locator('#fStatusPanel')).not.toHaveClass(/open/);
  });
});
