// 需求 / 今日收集(反馈) / 排班 / 附件 —— MySQL 后端
// 取代原飞书 /api/feishu 的对应 action，action 名与响应形状与 feishu.js 完全一致，
// 前端只需把请求 URL 从 /api/feishu 改到 /api/reqs，业务逻辑不变。
const { getPool, initTables } = require('./db');
const { logAudit } = require('./audit');

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};
function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }
function genId(prefix) { return prefix + Date.now() + "_" + Math.random().toString(36).slice(2, 6); }
function parseJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

// ============ 需求 映射 ============
function mapReqFromDb(r) {
  return {
    id: r.id,
    no: r.req_no || "",
    name: r.name || "",
    desc: r.description || "",
    type: r.req_type || "用户需求",
    plan: r.plan || "",
    priority: r.priority || "",
    status: r.status || "待开始",
    progress: parseInt(r.progress) || 0,
    person: r.person || "",
    deadline: r.deadline || "",
    design: r.design || "",
    review: r.review || "",
    createTime: r.create_time || "",
    submitter: r.submitter || "",
    note: r.note || "",
    parentId: r.parent_id || "",
    attachments: parseJson(r.attachments, []) || []
  };
}
const REQ_COLS = ["id", "req_no", "name", "description", "req_type", "plan", "priority", "status",
  "progress", "person", "deadline", "design", "review", "create_time", "submitter", "note", "parent_id", "attachments"];
// item -> 按 REQ_COLS 顺序的值数组
function reqValues(item, id) {
  return [
    id,
    String(item.no || ""),
    String(item.name || ""),
    String(item.desc || ""),
    String(item.type || "用户需求"),
    String(item.plan || ""),
    String(item.priority || ""),
    String(item.status || "待开始"),
    Math.max(0, Math.min(100, Math.round(parseInt(item.progress) || 0))),
    String(item.person || ""),
    String(item.deadline || ""),
    String(item.design || ""),
    String(item.review || ""),
    String(item.createTime || ""),
    String(item.submitter || ""),
    String(item.note || ""),
    String(item.parentId || ""),
    JSON.stringify(Array.isArray(item.attachments) ? item.attachments.map(a => ({ file_token: a.file_token, name: a.name || "", type: a.type || "" })) : [])
  ];
}

// ============ 反馈 映射 ============
function mapFbFromDb(r) {
  return {
    id: r.id,
    title: r.title || "",
    source: r.source || "其他",
    priority: r.priority || "中🟡",
    reporter: r.reporter || "",
    customerId: r.customer_id || "",
    desc: r.description || "",
    note: r.note || "",
    status: r.status || "待跟进",
    createTime: r.create_time || "",
    reqId: r.req_id || ""
  };
}
const FB_COLS = ["id", "title", "source", "priority", "reporter", "customer_id", "description", "note", "status", "create_time", "req_id"];
function fbValues(item, id) {
  return [
    id,
    String(item.title || ""),
    String(item.source || "其他"),
    String(item.priority || "中🟡"),
    String(item.reporter || ""),
    String(item.customerId || ""),
    String(item.desc || ""),
    String(item.note || ""),
    String(item.status || "待跟进"),
    String(item.createTime || ""),
    String(item.reqId || "")
  ];
}

// ============ 排班 映射 ============
function mapSchFromDb(r) {
  return {
    id: r.id,
    date: r.date_str || "",
    weekday: r.weekday || "",
    group: r.group_name || "",
    onDuty: r.on_duty || "",
    backup: r.backup || ""
  };
}
const SCH_COLS = ["id", "date_str", "weekday", "group_name", "on_duty", "backup"];
function schValues(item, id) {
  return [
    id,
    String(item.date || ""),
    String(item.weekday || ""),
    String(item.group || ""),
    String(item.onDuty || ""),
    String(item.backup || "")
  ];
}

// 通用：INSERT ... ON DUPLICATE KEY UPDATE（全列覆盖，排除主键）
function upsertSql(table, cols) {
  const ph = cols.map(() => "?").join(",");
  const upd = cols.filter(c => c !== "id" && c !== "token").map(c => `${c}=VALUES(${c})`).join(",");
  return `INSERT INTO ${table} (${cols.join(",")}) VALUES (${ph}) ON DUPLICATE KEY UPDATE ${upd}`;
}

// 需求字段级留痕：受审字段(前端字段名→中文名)。认领人不在此(由认领留痕承载)。
const AUDIT_FIELDS = [
  ["no", "需求编号"], ["name", "需求名称"], ["desc", "需求描述"], ["type", "需求类型"],
  ["plan", "所属计划"], ["priority", "优先级"], ["status", "开发状态"], ["progress", "开发进度"],
  ["deadline", "预计上线"], ["design", "是否需要设计"], ["review", "评审"], ["note", "备注"], ["parentId", "父需求"]
];
function _auditFmt(key, v) { return key === "progress" ? ((parseInt(v) || 0) + "%") : String(v == null ? "" : v); }
// 比对旧对象(mapReqFromDb)与新 body，产出变更留痕条目
function auditEntriesForReq(id, oldObj, body) {
  const out = [];
  for (const [key, label] of AUDIT_FIELDS) {
    if (!(key in body)) continue;
    const ov = key === "progress" ? (parseInt(oldObj[key]) || 0) : String(oldObj[key] == null ? "" : oldObj[key]).trim();
    const nv = key === "progress" ? (parseInt(body[key]) || 0) : String(body[key] == null ? "" : body[key]).trim();
    if (ov !== nv) out.push({ reqId: id, entityType: "req", action: "update", field: label, oldValue: _auditFmt(key, oldObj[key]), newValue: _auditFmt(key, body[key]) });
  }
  if ("attachments" in body) {
    const oldTok = (Array.isArray(oldObj.attachments) ? oldObj.attachments : []).map(a => a.file_token).sort().join(",");
    const newTok = (Array.isArray(body.attachments) ? body.attachments : []).map(a => a.file_token).sort().join(",");
    if (oldTok !== newTok) out.push({ reqId: id, entityType: "req", action: "update", field: "附件", oldValue: (oldObj.attachments || []).length + "个", newValue: (body.attachments || []).length + "个" });
  }
  return out;
}


exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const qs = event.queryStringParameters || {};
  const action = qs.action;
  const table = qs.table;

  try {
    await initTables();
    const pool = getPool();

    // ===================== GET 读取 =====================
    if (event.httpMethod === "GET") {
      if (table === "feedback") {
        const [rows] = await pool.query("SELECT * FROM feedback ORDER BY create_time DESC, created_at DESC");
        return ok(rows.map(mapFbFromDb));
      }
      if (table === "schedule") {
        const [rows] = await pool.query("SELECT * FROM schedule ORDER BY date_str ASC, id ASC");
        return ok(rows.map(mapSchFromDb));
      }
      if (table === "all") {
        const [[reqRows], [fbRows]] = await Promise.all([
          pool.query("SELECT * FROM reqs ORDER BY created_at DESC, id DESC"),
          pool.query("SELECT * FROM feedback ORDER BY create_time DESC, created_at DESC")
        ]);
        return ok({ requirements: reqRows.map(mapReqFromDb), feedback: fbRows.map(mapFbFromDb) });
      }
      // 默认：需求列表
      const [rows] = await pool.query("SELECT * FROM reqs ORDER BY created_at DESC, id DESC");
      return ok(rows.map(mapReqFromDb));
    }

    if (event.httpMethod !== "POST") return err("Method Not Allowed", 405);
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch (e) { return err("请求格式错误", 400); }

    // ===================== 需求 写操作 =====================
    if (action === "add") {
      if (!body.name) return err("需求名称不能为空", 400);
      const id = genId("req_");
      await pool.query(upsertSql("reqs", REQ_COLS), reqValues(body, id));
      await logAudit({ reqId: id, entityType: "req", action: "create", operator: body.operator, source: body.source || "manual", remark: (body.no ? body.no + " " : "") + (body.name || "") });
      const [rows] = await pool.query("SELECT * FROM reqs WHERE id=?", [id]);
      return ok({ ok: true, item: rows.length ? mapReqFromDb(rows[0]) : mapReqFromDb({ id, ...body }) });
    }
    if (action === "update") {
      if (!body.id) return err("缺少记录ID", 400);
      const [oldRows] = await pool.query("SELECT * FROM reqs WHERE id=?", [body.id]);
      const oldObj = oldRows.length ? mapReqFromDb(oldRows[0]) : null;
      await pool.query(upsertSql("reqs", REQ_COLS), reqValues(body, body.id));
      if (oldObj) {
        const entries = auditEntriesForReq(body.id, oldObj, body);
        entries.forEach(e => { e.operator = body.operator; e.source = body.source || "manual"; });
        await logAudit(entries);
      }
      return ok({ ok: true });
    }
    if (action === "delete") {
      if (!body.id) return err("缺少记录ID", 400);
      const [oldRows] = await pool.query("SELECT req_no,name FROM reqs WHERE id=?", [body.id]);
      await pool.execute("DELETE FROM reqs WHERE id=?", [body.id]);
      // 级联清理该需求关联数据（卡点/生命周期/流转/认领留痕），避免成为孤儿后仍被统计（如未解决卡点数）
      for (const sql of [
        "DELETE FROM collab_blockers WHERE req_id=?",
        "DELETE FROM req_lifecycle WHERE req_id=?",
        "DELETE FROM collab_flow_log WHERE req_id=?",
        "DELETE FROM collab_claim_log WHERE req_id=?"
      ]) { try { await pool.execute(sql, [body.id]); } catch (e) { console.warn("[reqs.delete cascade]", e.message); } }
      const o = oldRows[0] || {};
      await logAudit({ reqId: body.id, entityType: "req", action: "delete", operator: body.operator, source: body.source || "manual", remark: (o.req_no ? o.req_no + " " : "") + (o.name || "") });
      return ok({ ok: true });
    }
    if (action === "import") {
      const items = Array.isArray(body) ? body : [];
      if (!items.length) return err("数据为空", 400);
      await pool.query("DELETE FROM reqs");                       // 整表覆盖（与飞书旧行为一致）
      const rows = items.map(it => reqValues(it, genId("req_")));
      for (let i = 0; i < rows.length; i += 500) {
        await pool.query(`INSERT INTO reqs (${REQ_COLS.join(",")}) VALUES ?`, [rows.slice(i, i + 500)]);
      }
      await logAudit({ reqId: "", entityType: "req", action: "import", remark: "覆盖导入 " + items.length + " 条" });
      return ok({ ok: true, count: items.length });
    }

    // ===================== 反馈 写操作 =====================
    if (action === "fb-add") {
      if (!body.title) return err("标题不能为空", 400);
      const id = genId("fb_");
      await pool.query(upsertSql("feedback", FB_COLS), fbValues(body, id));
      const [rows] = await pool.query("SELECT * FROM feedback WHERE id=?", [id]);
      return ok({ ok: true, item: rows.length ? mapFbFromDb(rows[0]) : mapFbFromDb({ id, ...body }) });
    }
    if (action === "fb-update") {
      if (!body.id) return err("缺少记录ID", 400);
      await pool.query(upsertSql("feedback", FB_COLS), fbValues(body, body.id));
      return ok({ ok: true });
    }
    if (action === "fb-delete") {
      if (!body.id) return err("缺少记录ID", 400);
      await pool.execute("DELETE FROM feedback WHERE id=?", [body.id]);
      return ok({ ok: true });
    }

    // ===================== 排班 写操作 =====================
    if (action === "sch-add") {
      const id = genId("sch_");
      await pool.query(upsertSql("schedule", SCH_COLS), schValues(body, id));
      const [rows] = await pool.query("SELECT * FROM schedule WHERE id=?", [id]);
      return ok({ ok: true, item: rows.length ? mapSchFromDb(rows[0]) : mapSchFromDb({ id, ...body }) });
    }
    if (action === "sch-batch-add") {
      const items = Array.isArray(body) ? body : [];
      if (!items.length) return err("数据为空", 400);
      const rows = items.map(it => schValues(it, genId("sch_")));
      for (let i = 0; i < rows.length; i += 500) {
        await pool.query(`INSERT INTO schedule (${SCH_COLS.join(",")}) VALUES ?`, [rows.slice(i, i + 500)]);
      }
      return ok({ ok: true, count: items.length });
    }
    if (action === "sch-update") {
      if (!body.id) return err("缺少记录ID", 400);
      await pool.query(upsertSql("schedule", SCH_COLS), schValues(body, body.id));
      return ok({ ok: true });
    }
    if (action === "sch-delete") {
      if (!body.id) return err("缺少记录ID", 400);
      await pool.execute("DELETE FROM schedule WHERE id=?", [body.id]);
      return ok({ ok: true });
    }

    // ===================== 附件 =====================
    // 上传：收 {filename,mimetype,base64} -> 存 MySQL -> 返回 {file_token,name,type}
    if (action === "att-upload") {
      const { filename, mimetype, base64 } = body;
      if (!base64 || !filename) return err("缺少文件数据", 400);
      const token = genId("att_");
      const size = Buffer.from(base64, "base64").length;
      await pool.query(
        "INSERT INTO attachments (token,filename,mimetype,data,size) VALUES (?,?,?,?,?)",
        [token, String(filename), String(mimetype || ""), String(base64), size]
      );
      return ok({ file_token: token, name: filename, type: mimetype || "" });
    }
    // 预览/下载：收 {file_token} -> 返回文件字节（与旧 iss-file-url 响应形状一致）
    if (action === "att-get") {
      const { file_token } = body;
      if (!file_token) return err("缺少 file_token", 400);
      const [rows] = await pool.execute("SELECT mimetype,data FROM attachments WHERE token=?", [file_token]);
      if (!rows.length) return err("附件不存在", 404);
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": rows[0].mimetype || "application/octet-stream" },
        body: rows[0].data || "",
        isBase64Encoded: true
      };
    }

    return err("未知操作: " + action, 400);
  } catch (e) {
    console.error("[reqs] error:", e);
    return err(e.message);
  }
};
