# VSCode 连接 Git 及账号管理指南

## 一、前置准备

### 安装 Git
- 下载地址：https://git-scm.com/download/win
- 安装时一路默认即可
- 验证安装：打开终端输入 `git --version`

### 配置 Git 用户信息（已装过可跳过）
```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

---

## 二、克隆项目

### 方法一：通过 VSCode 界面克隆

1. 打开 VSCode
2. 按 `Ctrl+Shift+P` 打开命令面板
3. 输入 `Git: Clone`，回车
4. 粘贴仓库地址（如 `https://github.com/xxx/xxx.git`）
5. 选择本地保存目录
6. 点击 **Open** 打开克隆好的项目

### 方法二：通过终端克隆

1. 在 VSCode 中按 `` Ctrl+` `` 打开终端
2. 进入目标目录：
   ```bash
   cd D:\
   ```
3. 克隆仓库：
   ```bash
   git clone https://github.com/xxx/xxx.git
   ```
4. 用 VSCode 打开：`File > Open Folder`，选择克隆下来的文件夹

### 方法三：SSH 方式（推荐，避免每次输密码）

1. 生成 SSH Key：
   ```bash
   ssh-keygen -t ed25519 -C "你的邮箱"
   ```
   一路回车，密钥保存在 `C:\Users\你的用户名\.ssh\`

2. 复制公钥：
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```

3. 将公钥添加到 GitHub/Gitee：
   - GitHub：`Settings > SSH and GPG keys > New SSH key`
   - 粘贴公钥内容保存

4. 用 SSH 地址克隆：
   ```bash
   git clone git@github.com:xxx/xxx.git
   ```

### 验证连接成功

VSCode 左侧出现**源代码管理图标**，底部状态栏显示当前分支名（如 `main`），说明 Git 已正常连接。

---

## 三、解绑 Git 账号

### 方法一：清除 Windows 凭据管理器（最常用）

**界面操作：**
1. 打开 **控制面板** → **凭据管理器** → **Windows 凭据**
2. 找到 `git:https://github.com`（或 gitee 等）
3. 点击右侧箭头展开 → **删除**

**命令行操作：**
```powershell
# 查看已有凭据
cmdkey /list | findstr git

# 删除对应凭据
cmdkey /delete:git:https://github.com
```

### 方法二：清除全局 Git 配置

```bash
# 查看当前配置
git config --global --list

# 删除用户名和邮箱
git config --global --unset user.name
git config --global --unset user.email

# 删除存储的密码
git config --global --unset credential.helper
```

### 方法三：VSCode 内退出 GitHub 账号

1. 点击左下角**头像图标**或**账户图标**
2. 选择已登录的 GitHub 账号
3. 点击 **Sign Out**

### 删除 SSH Key（如果用的是 SSH 方式）

```powershell
Remove-Item ~/.ssh/id_ed25519
Remove-Item ~/.ssh/id_ed25519.pub
```

> **最彻底的方案：** 同时执行方法一 + 方法二，之后再 `git push` 时会重新提示输入账号密码。
