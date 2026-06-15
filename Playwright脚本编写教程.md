# Playwright 脚本编写教程（新手版）

> 写给完全新手。用本项目（需求池看板）的真实例子教你从零写一个测试脚本。
> 配套：跑测试的命令看 [测试指南.md](测试指南.md)；本文只讲**怎么写**。

---

## 0. 先搞懂三件事

1. **用什么语言**：JavaScript。本项目 `tests/` 里全是 `.spec.js`，照着写即可，不用学 TypeScript。
2. **什么语法**：就一套固定模板 + 6 个常用命令（下面列出），记住就够用。
3. **最快的写法**：用 `npx playwright codegen` 录制（第 7 节），它会把你的鼠标点击**自动变成代码**，新手神器。

---

## 1. 一个测试脚本长什么样（逐行解剖）

打开你项目的 `tests/bugs.spec.js`，最简结构是这样：

```javascript
const { test, expect } = require('@playwright/test');   // ① 固定开头，引入工具

test('我的第一个测试', async ({ page }) => {            // ② 一个 test = 一个测试场景
  await page.goto('/');                                  // ③ 打开网页
  await expect(page.locator('h1')).toBeVisible();        // ④ 检查页面上有个 h1
});
```

逐行解释：
- **① `const { test, expect } = require(...)`** —— 每个脚本第一行，照抄。`test` 用来定义测试，`expect` 用来做检查。
- **② `test('名字', async ({ page }) => { ... })`** —— 定义一个测试。
  - `'名字'` 随便起，跑的时候会显示出来。
  - `async ({ page }) => {}` 是固定写法，`page` 就是"那个浏览器页面"，你所有操作都对它下命令。
- **③ `await page.goto('/')`** —— 让浏览器打开网址。`/` 表示首页（http://localhost:3000）。
- **④ `await expect(...).toBeVisible()`** —— 断言（检查）：某个东西应该看得见。

> **关键规则：几乎每行都要加 `await`**。因为浏览器操作是"需要等待"的（点击、加载都要时间）。忘了 `await` 是新手最常见的 bug。

---

## 2. 6 个最常用命令（背下来就够用）

### 操作类（让浏览器做事）

| 命令 | 作用 | 例子（本项目真实可用） |
|------|------|------|
| `page.goto(url)` | 打开网址 | `await page.goto('/')` |
| `page.click(选择器)` | 点击 | `await page.click('button:has-text("登")')` |
| `page.fill(选择器, 文本)` | 在输入框填字 | `await page.fill('#loginUser', 'admin')` |
| `page.selectOption(选择器, 值)` | 选下拉框 | `await page.selectOption('#bfProduct', 'SAE2.3.3')` |

### 检查类（判断对不对）—— 用 `expect`

| 命令 | 作用 | 例子 |
|------|------|------|
| `expect(x).toBeVisible()` | x 看得见 | `await expect(page.locator('#bugModal')).toBeVisible()` |
| `expect(x).toHaveText('字')` | x 的文字等于 | `await expect(page.locator('#bugModalTitle')).toHaveText('新增 Bug')` |
| `expect(x).toContainText('字')` | x 包含某段文字 | `await expect(page.locator('#bugExportBtn')).toContainText('导出选中')` |
| `expect(x).toHaveCount(n)` | x 有 n 个 | `await expect(page.locator('.stat-card')).toHaveCount(8)` |

---

## 3. 最重要的概念：选择器（locator）—— 怎么"找到"页面上的东西

你要操作一个按钮/输入框，得先告诉 Playwright "是哪一个"。这就是**选择器**。常用 4 种：

| 写法 | 含义 | 例子 |
|------|------|------|
| `#id` | 按 id 找（最稳，优先用） | `page.locator('#bfTitle')` |
| `.类名` | 按 class 找 | `page.locator('.stat-card')` |
| `text=文字` | 按显示的文字找 | `page.locator('text=🐛 创新项目')` |
| `button:has-text("文字")` | 找包含某文字的按钮 | `page.locator('button:has-text("新增Bug")')` |

怎么知道一个元素的 id / class？看 [index.html](index.html) 源码，或者用第 7 节的**录制工具自动获取**。

> **小技巧**：`page.click('#abc')` 是 `page.locator('#abc').click()` 的简写，两种都行。

---

## 4. 本项目特有：先登录（很重要）

本项目要登录才能进功能页。所以**每个测试开头都得先登录**。本项目的标准登录写法（抄自 `tests/bugs.spec.js`）：

```javascript
async function login(page) {
  await page.goto('/');
  const loginVisible = await page.locator('#loginPage input').first().isVisible().catch(() => false);
  if (loginVisible) {
    await page.fill('#loginUser', 'admin');
    await page.fill('#loginPass', 'admin123');
    await page.click('button:has-text("登")');
  }
  await page.waitForSelector('.stat-row', { timeout: 15000 });  // 等需求列表出来
}
```

> ⚠️ 你现在打开的 `tests/list.spec.js` 是**老版本**，没写登录，所以现在直接跑会卡在登录页。新写的脚本记得套用上面的 `login(page)`。

---

## 5. 手把手：写一个完整的新用例

需求：测试「登录后，点开创新项目，能看到表格」。新建文件 `tests/练习.spec.js`：

```javascript
const { test, expect } = require('@playwright/test');

// ① 复制粘贴这个登录函数
async function login(page) {
  await page.goto('/');
  const loginVisible = await page.locator('#loginPage input').first().isVisible().catch(() => false);
  if (loginVisible) {
    await page.fill('#loginUser', 'admin');
    await page.fill('#loginPass', 'admin123');
    await page.click('button:has-text("登")');
  }
  await page.waitForSelector('.stat-row', { timeout: 15000 });
}

// ② describe 是"一组测试"的分类盒子，名字随便起
test.describe('我的练习', () => {

  // ③ beforeEach：每个 test 跑之前都先执行（这里用来先登录）
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ④ 第一个测试
  test('打开创新项目能看到表格', async ({ page }) => {
    await page.click('text=🐛 创新项目');                       // 点"创新项目"标签
    await expect(page.locator('#bugTableArea table')).toBeVisible();  // 检查表格出现
  });

  // ⑤ 第二个测试
  test('点新增Bug会弹出窗口', async ({ page }) => {
    await page.click('text=🐛 创新项目');
    await page.click('button:has-text("新增Bug")');             // 点"新增Bug"
    await expect(page.locator('#bugModal')).toBeVisible();       // 检查弹窗出现
    await expect(page.locator('#bugModalTitle')).toHaveText('新增 Bug');  // 检查标题
  });
});
```

跑它：
```bash
npx playwright test 练习
```

---

## 6. 写测试的固定思路（套路）

每个测试就三步，照着套：

```
1. 操作：去到某个页面 / 点某个按钮 / 填某个框
2. （可能还有更多操作）
3. 断言：检查"结果"是不是符合预期（用 expect）
```

例子：测"复制按钮"
```javascript
test('复制按钮能预填数据', async ({ page }) => {
  await page.click('text=🐛 创新项目');                          // 操作1：进创新项目
  await page.locator('#bugTableArea tbody tr').first()
            .locator('button:has-text("复制")').click();        // 操作2：点第一行的复制
  await expect(page.locator('#bugModalTitle')).toHaveText('复制新增 Bug');  // 断言：标题对不对
});
```

---

## 7. 新手神器：录制工具（自动生成代码）

不想手写选择器？让 Playwright **录制你的操作，自动生成代码**：

```bash
npx playwright codegen http://localhost:3000
```

会弹出两个窗口：
- 一个**真实浏览器**：你在里面正常点击、输入
- 一个**代码窗口**：你每点一下，它就自动写出对应的 `page.click(...)` 代码

你只要：① 在浏览器里把流程点一遍 → ② 把代码窗口生成的代码复制出来 → ③ 粘到你的 `.spec.js` 里，加上 `expect` 检查就行。

> 这是新手最快的入门方式：**先录，再改**。选择器都帮你找好了。

---

## 8. 怎么跑、怎么看结果

```bash
# 前提：另开一个终端，node server.js 让服务跑着

npx playwright test 练习              # 跑文件名含"练习"的
npx playwright test                   # 跑全部
HEADED=1 npx playwright test 练习     # 看着浏览器跑（Git Bash）
npx playwright show-report            # 跑完看图文报告
```

终端结果：`ok` / `passed` = 过了 ✅；`failed` = 挂了（报告里有失败截图）。

---

## 9. 新手最容易踩的 5 个坑

| 坑 | 现象 | 解决 |
|----|------|------|
| 忘了 `await` | 测试乱跳、时好时坏 | 每个 `page.xxx()`、`expect()` 前都加 `await` |
| 没登录 | 卡在登录页、找不到元素 | 测试开头先 `await login(page)` |
| 没启动服务 | 全部失败、页面空白 | 另开终端 `node server.js` |
| 选择器匹配到多个 | 报 `strict mode violation` | 用更精确的，如 `#bugTableArea th:has-text("编号")`，或 `.first()` |
| 元素还没出来就操作 | 报 timeout | 先 `await page.waitForSelector('#xxx')` 等它出现 |

---

## 10. 学习路线建议

1. 先用 `npx playwright codegen` 录 2~3 个流程，感受代码长什么样。
2. 照着第 5 节抄一个 `练习.spec.js`，改成你想测的功能。
3. 参考现成的 `tests/bugs.spec.js`、`tests/reqbugs.spec.js`（写得最全，含登录、增删改查、断言）。
4. 遇到不会的选择器，就去 [index.html](index.html) 搜对应的 id。

> 记住：**90% 的测试就是「点一下 → 检查一下」的重复**。套路固定，多写几个就熟了。
