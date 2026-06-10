# 测试说明

> 📖 **完整、详细的图文教程见项目根目录的 [`测试指南.md`](../测试指南.md)**（小白向，含每一步操作、概念讲解、问题排查）。
> 本文件只放最常用的速查命令。

## 三步快速开始

```bash
# 1. 进项目目录
cd d:/dashboard

# 2. 启动服务（终端A，保持开着别关）
node server.js

# 3. 另开终端B 跑测试
npx playwright test bugs
```

## 常用命令

```bash
npx playwright test                    # 跑全部测试
npx playwright test bugs               # 只跑创新项目
npx playwright test -g "复制按钮"       # 按名字跑某一个用例
HEADED=1 npx playwright test bugs      # 看浏览器自动操作（Git Bash）
$env:HEADED=1; npx playwright test bugs  # 看浏览器自动操作（PowerShell）
npx playwright test --ui               # 可视化面板逐步回放
npx playwright show-report             # 打开 HTML 报告（失败带截图）
```

## 测试文件说明

| 文件 | 覆盖模块 | 状态 |
|------|---------|------|
| `bugs.spec.js` | 创新项目（编号列、复选框、详情抽屉、复制、导出选中、搜索） | ✅ 10 用例全过 |
| `list.spec.js` | 需求列表 | 早期版本，未含登录 |
| `add-edit.spec.js` | 新增/编辑需求 | 早期版本，未含登录 |
| `kanban.spec.js` | 开发看板 | 早期版本，未含登录 |
| `person.spec.js` | 人员任务 | 早期版本，未含登录 |
| `feedback.spec.js` | 今日收集 | 早期版本，未含登录 |
| `claim.spec.js` | 认领 | 早期版本，未含登录 |

> 早期脚本写于登录系统上线前，跑前可能需要在 `beforeEach` 里补登录逻辑（参考 `bugs.spec.js`）。
