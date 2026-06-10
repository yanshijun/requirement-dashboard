// @ts-check
const { defineConfig } = require('@playwright/test');

// 用 HEADED=1 npx playwright test 可以看到浏览器窗口
// 用 npx playwright test --ui 打开可视化面板逐步回放
module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    headless: process.env.HEADED ? false : true,
    launchOptions: {
      slowMo: process.env.HEADED ? 600 : 0, // 有头模式放慢动作，方便肉眼观察
    },
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: process.env.HEADED ? 'on' : 'off',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
