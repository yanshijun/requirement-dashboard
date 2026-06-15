// 我的第一个 Playwright 测试 —— 跟着注释看，每行都讲清楚了
// 跑法：先 node server.js，再另开终端 npx playwright test 练习

const { test, expect } = require('@playwright/test');   // 固定开头：引入 test 和 expect

// 【登录函数】本项目要登录才能进，所以先抄这个函数（来自 bugs.spec.js）
async function login(page) {
  await page.goto('/');                                  // 打开首页
  const needLogin = await page.locator('#loginPage input').first().isVisible().catch(() => false);
  if (needLogin) {                                       // 如果登录框出现了，就登录
    await page.fill('#loginUser', 'admin');              // 用户名框填 admin
    await page.fill('#loginPass', 'admin123');           // 密码框填 admin123
    await page.click('button:has-text("登")');           // 点"登录"按钮
  }
  await page.waitForSelector('.stat-row', { timeout: 15000 });  // 等需求列表加载出来
}

// 【一组测试】describe 是分类盒子，名字随便起
test.describe('我的第一个练习', () => {

  // 【准备工作】每个 test 跑之前，先自动登录
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // 【正式用例】搜一个不存在的词，应显示"暂无数据"
  test('搜索不存在的关键词显示暂无数据', async ({ page }) => {
    // 第1步【操作】：点顶部"创新项目"标签，进入 Bug 列表
    await page.click('text=🐛 创新项目');

    // 第2步【等待】：等搜索框出现，确保页面准备好了
    await page.waitForSelector('#bugFSearch', { timeout: 15000 });

    // 第3步【操作】：在搜索框里输入一个肯定搜不到的词
    await page.fill('#bugFSearch', '这个词肯定不存在xyz123');

    // 第4步【等一下】：给页面一点时间过滤（输入后列表会重新渲染）
    await page.waitForTimeout(500);

    // 第5步【断言】：检查表格区域里出现了"暂无数据"
    await expect(page.locator('#bugTableArea')).toContainText('暂无数据');
  });

  test('创新项目显示统计卡片', async ({ page }) => {
    await page.click('text=🐛 创新项目');                     // 操作：点创新项目标签
    await expect(page.locator('.bug-stats')).toBeVisible();   // 断言：统计卡片区看得见
  });
});

