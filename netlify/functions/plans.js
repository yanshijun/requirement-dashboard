const { getPool, initTables } = require('./db');

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;

  try {
    await initTables();
    const pool = getPool();

    // ===== 列表 =====
    if (event.httpMethod === "GET" || action === "list") {
      const [rows] = await pool.execute("SELECT name FROM req_plans ORDER BY id ASC");
      return ok(rows.map(r => r.name));
    }

    const body = JSON.parse(event.body || "{}");

    // ===== 新增 =====
    if (action === "add") {
      const name = (body.name || "").trim();
      if (!name) return err("计划名称不能为空", 400);
      if (name.length > 100) return err("计划名称过长", 400);
      await pool.execute("INSERT IGNORE INTO req_plans (name) VALUES (?)", [name]);
      return ok({ ok: true });
    }

    // ===== 删除 =====
    if (action === "delete") {
      const name = (body.name || "").trim();
      if (!name) return err("缺少计划名称", 400);
      await pool.execute("DELETE FROM req_plans WHERE name=?", [name]);
      return ok({ ok: true });
    }

    return err("未知操作: " + action, 400);
  } catch (e) {
    console.error("[plans] error:", e);
    return err(e.message);
  }
};
