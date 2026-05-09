const { getPool, initTables } = require('./db');

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }

function genId() {
  return "bug_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;

  try {
    await initTables();
    const pool = getPool();

    // ===== 列表 =====
    if (event.httpMethod === "GET" || action === "list") {
      const q = event.queryStringParameters?.q || "";
      const product = event.queryStringParameters?.product || "";
      const severity = event.queryStringParameters?.severity || "";
      const status = event.queryStringParameters?.status || "";

      let sql = "SELECT * FROM innovation_bugs WHERE 1=1";
      const params = [];
      if (product) { sql += " AND product=?"; params.push(product); }
      if (severity) { sql += " AND severity=?"; params.push(severity); }
      if (status) { sql += " AND status=?"; params.push(status); }
      if (q) {
        sql += " AND (title LIKE ? OR description LIKE ? OR module LIKE ?)";
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      sql += " ORDER BY created_at DESC";
      const [rows] = await pool.execute(sql, params);
      return ok(rows.map(r => ({
        id: r.id,
        product: r.product,
        module: r.module,
        title: r.title,
        description: r.description,
        attachments: Array.isArray(r.attachments) ? r.attachments : (() => { try { return JSON.parse(r.attachments || '[]'); } catch(e) { return []; } })(),
        severity: r.severity,
        status: r.status,
        reporter: r.reporter,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })));
    }

    const body = JSON.parse(event.body || "{}");

    // ===== 新增 =====
    if (action === "add") {
      const { product, module, title, description, attachments, severity, status, reporter } = body;
      if (!product) return err("所属产品不能为空", 400);
      if (!title) return err("Bug标题不能为空", 400);
      const id = genId();
      await pool.execute(
        "INSERT INTO innovation_bugs (id,product,module,title,description,attachments,severity,status,reporter) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, product, module || "", title, description || "", JSON.stringify(attachments || []), severity || "3级", status || "待处理", reporter || ""]
      );
      return ok({ ok: true, id });
    }

    // ===== 更新 =====
    if (action === "update") {
      const { id, product, module, title, description, attachments, severity, status, reporter } = body;
      if (!id) return err("缺少 id", 400);
      if (!product) return err("所属产品不能为空", 400);
      if (!title) return err("Bug标题不能为空", 400);
      await pool.execute(
        "UPDATE innovation_bugs SET product=?,module=?,title=?,description=?,attachments=?,severity=?,status=?,reporter=?,updated_at=NOW() WHERE id=?",
        [product, module || "", title, description || "", JSON.stringify(attachments || []), severity || "3级", status || "待处理", reporter || "", id]
      );
      return ok({ ok: true });
    }

    // ===== 删除 =====
    if (action === "delete") {
      const { id } = body;
      if (!id) return err("缺少 id", 400);
      await pool.execute("DELETE FROM innovation_bugs WHERE id=?", [id]);
      return ok({ ok: true });
    }

    return err("未知操作: " + action, 400);
  } catch (e) {
    console.error("[bugs] error:", e);
    return err(e.message);
  }
};
