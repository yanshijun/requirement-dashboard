# 代码提交与部署指南

## 项目概述

**项目名称**: Requirement Dashboard（需求仪表板）
**仓库地址**: https://github.com/yanshijun/requirement-dashboard
**部署平台**: Netlify
**技术栈**: Node.js + Express + Netlify Functions

---

## 一、代码提交流程

### 1.1 提交前检查

```bash
# 查看当前修改状态
git status

# 查看具体改动
git diff
```

### 1.2 暂存文件

```bash
# 暂存所有修改
git add .

# 或暂存特定文件
git add <file-path>
```

### 1.3 提交代码

```bash
# 提交代码，使用清晰的提交信息
git commit -m "功能描述：具体改动内容"

# 提交信息规范示例：
# - "修复飞书token失效问题：自动刷新重试"
# - "人员任务点击需求名称可查看详情"
# - "优化性能：缓存API响应数据"
```

### 1.4 推送到远程仓库

```bash
# 推送到主分支
git push origin main

# 或简写（已设置上游分支）
git push
```

### 1.5 完整提交示例

```bash
cd d:/dashboard
git add index.html netlify/functions/feishu.js
git commit -m "功能：添加需求详情查看和token自动刷新"
git push
```

---

## 二、部署流程

### 2.1 自动部署（推荐）

Netlify 已配置自动部署，当代码推送到 GitHub main 分支时，会自动触发部署：

1. **推送代码到 GitHub**
   ```bash
   git push origin main
   ```

2. **Netlify 自动检测**
   - GitHub webhook 触发 Netlify 构建
   - 自动执行构建命令

3. **构建配置**（netlify.toml）
   ```toml
   [build]
     publish = "."

   [functions]
     directory = "netlify/functions"
     node_bundler = "esbuild"
   ```

4. **部署完成**
   - 构建成功后自动发布
   - 访问 Netlify 提供的域名查看效果

### 2.2 手动部署

如需手动部署，可使用 Netlify CLI：

```bash
# 安装 Netlify CLI
npm install -g netlify-cli

# 登录 Netlify
netlify login

# 部署项目
netlify deploy --prod
```

### 2.3 部署检查

部署完成后验证：

1. **访问应用**
   - 打开 Netlify 提供的生产环境 URL
   - 检查页面是否正常加载

2. **功能测试**
   - 测试人员任务点击功能
   - 验证飞书数据是否正常获取
   - 检查 token 自动刷新是否生效

3. **查看日志**
   - Netlify Dashboard → Deploys → 查看构建日志
   - 检查是否有错误或警告

---

## 三、项目结构

```
requirement-dashboard/
├── index.html                 # 前端主页面
├── server.js                  # Express 服务器
├── netlify.toml              # Netlify 配置文件
├── package.json              # 项目依赖配置
├── netlify/
│   └── functions/
│       └── feishu.js         # 飞书 API 集成函数
├── tests/                    # 测试文件
└── data/                     # 数据文件
```

---

## 四、常见操作

### 4.1 查看提交历史

```bash
# 查看最近提交
git log --oneline -10

# 查看详细提交信息
git log --oneline --graph --all
```

### 4.2 撤销操作

```bash
# 撤销未暂存的修改
git checkout -- <file-path>

# 撤销已暂存的修改
git reset HEAD <file-path>

# 撤销最后一次提交（保留修改）
git reset --soft HEAD~1

# 撤销最后一次提交（丢弃修改）
git reset --hard HEAD~1
```

### 4.3 分支管理

```bash
# 查看本地分支
git branch

# 创建新分支
git checkout -b feature/new-feature

# 切换分支
git checkout main

# 删除分支
git branch -d feature/new-feature
```

---

## 五、环境变量配置

### 5.1 本地开发

在项目根目录创建 `.env` 文件（不提交到 Git）：

```env
FEISHU_APP_ID=<your-app-id>
FEISHU_APP_SECRET=<your-app-secret>
```

### 5.2 Netlify 环境变量

在 Netlify Dashboard 中配置：

1. 进入 Site settings → Build & deploy → Environment
2. 添加环境变量：
   - `FEISHU_APP_ID`
   - `FEISHU_APP_SECRET`

---

## 六、故障排查

### 6.1 部署失败

**问题**: 构建失败
**解决**:
1. 检查 Netlify 构建日志
2. 确保 `package.json` 依赖正确
3. 验证 `netlify.toml` 配置

### 6.2 功能异常

**问题**: 飞书数据无法获取
**解决**:
1. 检查环境变量是否正确配置
2. 查看浏览器控制台错误信息
3. 检查 `netlify/functions/feishu.js` 日志

### 6.3 Token 失效

**问题**: 返回错误码 99991663
**解决**:
- 已实现自动刷新机制，无需手动处理
- 检查 `feishu.js` 中的重试逻辑是否生效

---

## 七、最佳实践

1. **提交信息规范**
   - 使用清晰、简洁的提交信息
   - 说明改动的功能或修复的问题

2. **频繁提交**
   - 每完成一个功能点就提交一次
   - 便于追踪和回滚

3. **测试后再推送**
   - 本地测试通过后再推送
   - 避免部署有问题的代码

4. **查看部署状态**
   - 推送后及时检查 Netlify 部署状态
   - 确保部署成功

5. **保持分支整洁**
   - 定期删除已合并的分支
   - 使用有意义的分支名称

---

## 八、快速参考

```bash
# 完整工作流
git status                    # 查看状态
git add .                     # 暂存所有修改
git commit -m "提交信息"      # 提交代码
git push                      # 推送到远程
# Netlify 自动部署...
# 访问应用验证
```

---

## 联系与支持

- **GitHub Issues**: https://github.com/yanshijun/requirement-dashboard/issues
- **Netlify Dashboard**: https://app.netlify.com
