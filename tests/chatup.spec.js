const { test, expect } = require('@playwright/test');

// 问题记录 CHAT-UP 字段：新增（长JSON）→ 列表标记 → 详情抽屉美化显示
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

test.describe('问题记录 CHAT-UP 字段', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('新增带 CHAT-UP 的记录，列表有标记、抽屉美化显示 JSON', async ({ page, request }) => {
    await page.click('text=📝 问题记录');
    await page.waitForSelector('button:has-text("新增记录")', { timeout: 15000 });
    await page.click('button:has-text("新增记录")');
    await expect(page.locator('#issModal')).toBeVisible();

    const tag = 'CHATUP_E2E_' + Date.now();
    await page.selectOption('#issPlatform', '千牛');
    await page.fill('#issDesc', tag);
    // CHAT-UP 字段存在，填入未格式化的长 JSON
    await expect(page.locator('#issChatUp')).toBeVisible();
    await page.fill('#issChatUp', '{"sessionId":"s1","messages":[{"role":"user","content":"hi"}],"meta":{"score":0.9}}');
    // 点格式化按钮 → 变成带缩进的多行
    await page.click('button:has-text("格式化")');
    const formatted = await page.locator('#issChatUp').inputValue();
    expect(formatted).toContain('\n');           // 已美化为多行
    expect(formatted).toContain('"sessionId"');

    await page.click('#issModal button:has-text("保存")');
    await page.waitForTimeout(800);

    // 列表里这条记录所在行有 🧩 标记
    const row = page.locator('tbody tr', { hasText: tag });
    await expect(row).toContainText('🧩');

    // 点开详情抽屉，CHAT-UP 区块出现，消息渲染成对话气泡
    await row.click();
    await expect(page.locator('#issDrawer.open')).toBeVisible();
    await expect(page.locator('#issDrawerBody')).toContainText('CHAT-UP');
    await expect(page.locator('#issDrawerBody')).toContainText('对话 1 条');  // messages 数组被识别
    await expect(page.locator('#issDrawerBody')).toContainText('🧑 user');
    await expect(page.locator('#issDrawerBody')).toContainText('hi');

    // 清理
    const list = await (await request.post('/api/kb?action=iss-list', { data: {} })).json();
    const rec = list.find(x => x.desc === tag);
    if (rec) await request.post('/api/kb?action=iss-delete', { data: { id: rec.id } });
  });

  test('顶层数组 + 超长 content（带大量\\n）渲染成对话气泡且换行还原', async ({ page, request }) => {
    const tag = 'CHATUP_LONG_' + Date.now();
    // 模拟真实数据：顶层数组，一个 user 消息，content 是带换行的长文本
    const chatUp = JSON.stringify([
      { role: 'user', content: '第一行\n第二行\n# 标题\n- 列表项A\n- 列表项B\n结尾行' }
    ]);
    const add = await (await request.post('/api/kb?action=iss-add', { data: { desc: tag, platform: '抖店', chatUp } })).json();

    await page.click('text=📝 问题记录');
    await page.waitForSelector('button:has-text("新增记录")', { timeout: 15000 });
    const row = page.locator('tbody tr', { hasText: tag });
    await expect(row).toContainText('🧩');
    await row.click();
    await expect(page.locator('#issDrawer.open')).toBeVisible();
    await expect(page.locator('#issDrawerBody')).toContainText('对话 1 条');
    // content 用 white-space:pre-wrap 渲染，断言文本里真的包含换行（不是字面 \n）
    const bubbleText = await page.locator('#issDrawerBody').innerText();
    expect(bubbleText).toContain('第一行');
    expect(bubbleText).toContain('结尾行');
    expect(bubbleText).not.toContain('\\n');   // 不应出现字面的反斜杠 n

    if (add.id) await request.post('/api/kb?action=iss-delete', { data: { id: add.id } });
  });
});
