const { getPool, initTables } = require('./db');
const bcrypt = require('bcryptjs');
const { validateToken } = require('./auth');

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }

async function requireAdmin(event) {
  const token = (event.headers?.authorization || '').replace('Bearer ', '');
  const user = await validateToken(token);
  if (!user) return { error: '未登录', code: 401 };
  if (user.role !== 'admin') return { error: '无权限，仅管理员可操作', code: 403 };
  return { user };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;

  try {
    await initTables();
    const pool = getPool();

    // ===== 用户列表（仅管理员） =====
    if (action === "list") {
      const auth = await requireAdmin(event);
      if (auth.error) return err(auth.error, auth.code);

      const [rows] = await pool.execute(
        "SELECT id, username, display_name, role, permissions, status, last_login, created_at FROM sys_users ORDER BY id ASC"
      );
      return ok(rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        role: r.role,
        permissions: Array.isArray(r.permissions) ? r.permissions : (typeof r.permissions === 'string' ? JSON.parse(r.permissions || '{}') : r.permissions || {}),
        status: r.status,
        lastLogin: r.last_login,
        createdAt: r.created_at
      })));
    }

    const body = JSON.parse(event.body || "{}");

    // ===== 新增用户（仅管理员） =====
    if (action === "add") {
      const auth = await requireAdmin(event);
      if (auth.error) return err(auth.error, auth.code);

      const { username, password, displayName, role, permissions } = body;
      if (!username || !password) return err("用户名和密码不能为空", 400);
      if (password.length < 6) return err("密码至少6位", 400);
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) return err("用户名只能包含字母数字下划线，3-30位", 400);

      const [exists] = await pool.execute("SELECT id FROM sys_users WHERE username=?", [username]);
      if (exists.length) return err("用户名已存在", 400);

      const hash = bcrypt.hashSync(password, 10);
      const perms = permissions || { tabs: {} };
      await pool.execute(
        "INSERT INTO sys_users (username, password, display_name, role, permissions) VALUES (?,?,?,?,?)",
        [username, hash, displayName || username, role || 'user', JSON.stringify(perms)]
      );
      return ok({ ok: true });
    }

    // ===== 更新用户（仅管理员） =====
    if (action === "update") {
      const auth = await requireAdmin(event);
      if (auth.error) return err(auth.error, auth.code);

      const { id, displayName, role, permissions, status } = body;
      if (!id) return err("缺少 id", 400);

      const [rows] = await pool.execute("SELECT * FROM sys_users WHERE id=?", [id]);
      if (!rows.length) return err("用户不存在", 404);
      if (rows[0].username === 'admin' && role !== 'admin') return err("不能修改超管角色", 400);

      await pool.execute(
        "UPDATE sys_users SET display_name=?, role=?, permissions=?, status=? WHERE id=?",
        [displayName || rows[0].display_name, role || rows[0].role, JSON.stringify(permissions || {}), status || 'active', id]
      );
      return ok({ ok: true });
    }

    // ===== 重置密码（仅管理员） =====
    if (action === "reset-password") {
      const auth = await requireAdmin(event);
      if (auth.error) return err(auth.error, auth.code);

      const { id, newPassword } = body;
      if (!id || !newPassword) return err("缺少参数", 400);
      if (newPassword.length < 6) return err("密码至少6位", 400);

      const hash = bcrypt.hashSync(newPassword, 10);
      await pool.execute("UPDATE sys_users SET password=? WHERE id=?", [hash, id]);
      return ok({ ok: true });
    }

    // ===== 删除用户（仅管理员） =====
    if (action === "delete") {
      const auth = await requireAdmin(event);
      if (auth.error) return err(auth.error, auth.code);

      const { id } = body;
      if (!id) return err("缺少 id", 400);

      const [rows] = await pool.execute("SELECT username FROM sys_users WHERE id=?", [id]);
      if (rows[0]?.username === 'admin') return err("不能删除超级管理员", 400);

      await pool.execute("DELETE FROM sys_users WHERE id=?", [id]);
      return ok({ ok: true });
    }

    return err("未知操作: " + action, 400);
  } catch (e) {
    console.error("[users] error:", e);
    return err(e.message);
  }
};
