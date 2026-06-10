const { test, expect } = require('@playwright/test');

// 回归：粘贴图片只触发一次上传（修复"每次粘贴两张"）
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

async function pasteImageInto(page, selector) {
  await page.evaluate((sel) => {
    const dt = new DataTransfer();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' });
    dt.items.add(file);
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: dt });
    document.querySelector(sel).dispatchEvent(e);
  }, selector);
}

test.describe('Bug 粘贴图片', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('粘贴图片只触发一次上传（创新项目）', async ({ page }) => {
    await page.click('text=🐛 创新项目');
    await page.waitForSelector('#bugTableArea', { timeout: 15000 });
    await page.click('button:has-text("＋ 新增Bug")');
    await expect(page.locator('#bugModal')).toBeVisible();
    // 用计数器替换 uploadBugAtt，统计调用次数（与真实上传接口解耦）
    await page.evaluate(() => { window.__cnt = 0; window.uploadBugAtt = async () => { window.__cnt++; }; });
    await pasteImageInto(page, '#bfDesc');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__cnt)).toBe(1);
  });

  test('粘贴图片只触发一次上传（需求 Bug 清单）', async ({ page }) => {
    await page.click('button:has-text("🐛 Bug清单")');
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });
    await page.click('button:has-text("＋ 新增Bug")');
    await expect(page.locator('#bugModal')).toBeVisible();
    await page.evaluate(() => { window.__cnt = 0; window.uploadBugAtt = async () => { window.__cnt++; }; });
    await pasteImageInto(page, '#bfAttList');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__cnt)).toBe(1);
  });
});
