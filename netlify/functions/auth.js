const { getPool, initTables } = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }

// token 管理：持久化到 MySQL（sys_sessions 表），后端重启后登录不失效
const TOKEN_EXPIRE = 7 * 24 * 60 * 60 * 1000; // 7天（一星期）

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 校验 token：查库、过期即删并返回 null，否则返回登录时快照的 user。异步（读 DB）。
async function validateToken(token) {
  if (!token) return null;
  try {
    const pool = getPool();
    const [rows] = await pool.execute("SELECT user_json, expire_at FROM sys_sessions WHERE token=?", [token]);
    if (!rows.length) return null;
    const row = rows[0];
    if (new Date(row.expire_at).getTime() < Date.now()) {
      pool.execute("DELETE FROM sys_sessions WHERE token=?", [token]).catch(() => {});
      return null;
    }
    const u = row.user_json;
    return (typeof u === 'string') ? JSON.parse(u) : u;
  } catch (e) {
    console.error("[auth] validateToken error:", e);
    return null;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;

  try {
    await initTables();
    const pool = getPool();

    // ===== 登录 =====
    if (action === "login") {
      const body = JSON.parse(event.body || "{}");
      const { username, password } = body;
      if (!username || !password) return err("用户名和密码不能为空", 400);

      const [rows] = await pool.execute("SELECT * FROM sys_users WHERE username=?", [username]);
      if (!rows.length) return err("用户名或密码错误", 401);

      const user = rows[0];
      if (user.status === 'disabled') return err("账号已被禁用", 403);

      const valid = bcrypt.compareSync(password, user.password);
      if (!valid) return err("用户名或密码错误", 401);

      const token = generateToken();
      const permissions = Array.isArray(user.permissions) ? user.permissions : (typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions || {});
      const sessionUser = { id: user.id, username: user.username, displayName: user.display_name, role: user.role, permissions };
      const expireAt = new Date(Date.now() + TOKEN_EXPIRE);
      // 持久化会话到 DB（重启不失效）；顺手清理该用户已过期的旧会话
      await pool.execute(
        "INSERT INTO sys_sessions (token, user_id, user_json, expire_at) VALUES (?,?,?,?)",
        [token, user.id, JSON.stringify(sessionUser), expireAt]
      );
      pool.execute("DELETE FROM sys_sessions WHERE expire_at < NOW()").catch(() => {});

      await pool.execute("UPDATE sys_users SET last_login=NOW() WHERE id=?", [user.id]);

      return ok({
        token,
        user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, permissions }
      });
    }

    // ===== 验证 token =====
    if (action === "check") {
      const token = (event.headers?.authorization || '').replace('Bearer ', '');
      const user = await validateToken(token);
      if (!user) return err("未登录或登录已过期", 401);
      return ok({ user });
    }

    // ===== 登出 =====
    if (action === "logout") {
      const token = (event.headers?.authorization || '').replace('Bearer ', '');
      if (token) await pool.execute("DELETE FROM sys_sessions WHERE token=?", [token]).catch(() => {});
      return ok({ ok: true });
    }

    // ===== 修改密码 =====
    if (action === "change-password") {
      const token = (event.headers?.authorization || '').replace('Bearer ', '');
      const user = await validateToken(token);
      if (!user) return err("未登录", 401);

      const body = JSON.parse(event.body || "{}");
      const { oldPassword, newPassword } = body;
      if (!oldPassword || !newPassword) return err("旧密码和新密码不能为空", 400);
      if (newPassword.length < 6) return err("新密码至少6位", 400);

      const [rows] = await pool.execute("SELECT password FROM sys_users WHERE id=?", [user.id]);
      if (!rows.length) return err("用户不存在", 404);

      if (!bcrypt.compareSync(oldPassword, rows[0].password)) return err("旧密码错误", 400);

      const hash = bcrypt.hashSync(newPassword, 10);
      await pool.execute("UPDATE sys_users SET password=? WHERE id=?", [hash, user.id]);
      return ok({ ok: true });
    }

    return err("未知操作: " + action, 400);
  } catch (e) {
    console.error("[auth] error:", e);
    return err(e.message);
  }
};

exports.validateToken = validateToken;
