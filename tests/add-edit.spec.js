const { test, expect } = require('@playwright/test');

test.describe('新增/编辑需求', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
  });

  test('点击新增需求打开弹窗', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    await expect(page.locator('#modal')).toBeVisible();
    await expect(page.locator('#modalTitle')).toHaveText('新增需求');
  });

  test('编号自动生成且只读', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    const no = await page.locator('#fNo').inputValue();
    expect(no).toMatch(/^URQ-\d+$/);
    await expect(page.locator('#fNo')).toBeDisabled();
  });

  test('提出时间默认当前日期', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    const today = new Date().toISOString().split('T')[0];
    await expect(page.locator('#fFCreateTime')).toHaveValue(today);
  });

  test('名称为空时不能保存', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    page.once('dialog', d => d.accept());
    await page.click('#saveBtn');
    await expect(page.locator('#modal')).toBeVisible();
  });

  test('填写完整信息后保存成功', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    const name = '自动化测试需求_' + Date.now();
    await page.fill('#fName', name);
    await page.selectOption('#fFStatus', '开发中');
    await page.click('#saveBtn');
    await page.waitForSelector('.stat-row', { timeout: 15000 });
    await expect(page.locator('td').filter({ hasText: name })).toBeVisible();
  });

  test('编辑需求弹窗预填数据', async ({ page }) => {
    const editBtn = page.locator('button:has-text("编辑")').first();
    const hasBtn = await editBtn.isVisible().catch(() => false);
    if (hasBtn) {
      await editBtn.click();
      await expect(page.locator('#modal')).toBeVisible();
      await expect(page.locator('#modalTitle')).toHaveText('编辑需求');
      const name = await page.locator('#fName').inputValue();
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('Markdown 描述预览切换', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    await page.fill('#fDesc', '# 测试标题\n\n- 列表项1');
    await page.click('#tabPrev');
    await expect(page.locator('#descPreview')).toBeVisible();
    await expect(page.locator('#fDesc')).not.toBeVisible();
    await page.click('#tabEdit');
    await expect(page.locator('#fDesc')).toBeVisible();
  });

  test('新增计划', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    page.once('dialog', async d => { await d.accept('测试计划_' + Date.now()); });
    await page.click('button:has-text("+ 新增")');
    await page.waitForTimeout(300);
    const options = await page.locator('#fFPlan option').allTextContents();
    expect(options.some(o => o.includes('测试计划'))).toBeTruthy();
  });

  test('关闭弹窗', async ({ page }) => {
    await page.click('button:has-text("新增需求")');
    await page.click('.modal-close');
    await expect(page.locator('#modal')).not.toBeVisible();
  });
});
