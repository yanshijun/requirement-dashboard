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
function fmtDate(v) {
  if (!v) return '';
  try { const d = new Date(v); if (isNaN(d.getTime())) return String(v);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } catch (e) { return ''; }
}
function toDate(v) { return v ? v : null; }

const STAGES = ['提报', '研发评审', '开发认领', '测试认领', '上线'];
// 缺省生命周期：提报默认已完成(需求已提交)，其余未开始；每阶段成员各自进度
function defaultStages() {
  const o = {};
  STAGES.forEach((s, i) => { o[s] = { status: i === 0 ? '已完成' : '未开始', members: [], due: '' }; });
  return o;
}
function normMembers(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = {};
  const out = [];
  raw.forEach(m => {
    const name = String((m && m.name) || '').trim();
    if (!name || seen[name]) return;
    seen[name] = 1;
    out.push({ name, progress: Math.max(0, Math.min(100, parseInt(m && m.progress) || 0)) });
  });
  return out;
}
// 归一化：确保四阶段都在，且成员为 [{name,progress}]；兼容旧格式 {owner,progress}
function normStages(raw) {
  const base = defaultStages();
  const src = raw || {};
  STAGES.forEach(s => {
    const cur = src[s];
    if (!cur) return;
    let members;
    if (Array.isArray(cur.members)) {
      members = normMembers(cur.members);
    } else if (cur.owner !== undefined) {
      const p = Math.max(0, Math.min(100, parseInt(cur.progress) || 0));
      members = normMembers(String(cur.owner || '').split(/[,，、]/).map(n => ({ name: n, progress: p })));
    } else {
      members = [];
    }
    base[s] = { status: cur.status || base[s].status, members, due: (typeof cur.due === 'string' ? cur.due.slice(0, 10) : '') };
  });
  return base;
}

function mapBlocker(r) {
  return {
    id: r.id, seqNo: r.seq_no, reqId: r.req_id || '', dept: r.dept || '', stage: r.stage || '',
    description: r.description || '', impact: r.impact || '', occurredAt: fmtDate(r.occurred_at),
    resourcesNeeded: r.resources_needed || '', expectedResolveAt: fmtDate(r.expected_resolve_at),
    follower: r.follower || '', progressNote: r.progress_note || '', status: r.status || '待处理',
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

// 生命周期阶段编辑留痕：比对旧/新 stages，产出阶段状态/成员进度/成员增删的变更条目
function auditStageDiff(reqId, oldStages, newStages, operator) {
  const out = [];
  STAGES.forEach(s => {
    const o = oldStages[s] || { status: '未开始', members: [] };
    const n = newStages[s] || { status: '未开始', members: [] };
    if ((o.status || '') !== (n.status || '')) out.push({ reqId, entityType: 'stage', action: 'stage-edit', field: `${s}·状态`, oldValue: o.status || '', newValue: n.status || '', operator });
    if ((o.due || '') !== (n.due || '')) out.push({ reqId, entityType: 'stage', action: 'stage-edit', field: `${s}·计划完成日`, oldValue: o.due || '未设', newValue: n.due || '未设', operator });
    const om = {}; (o.members || []).forEach(m => om[m.name] = parseInt(m.progress) || 0);
    const nm = {}; (n.members || []).forEach(m => nm[m.name] = parseInt(m.progress) || 0);
    Object.keys(nm).forEach(name => {
      if (!(name in om)) out.push({ reqId, entityType: 'stage', action: 'stage-edit', field: `${s}·成员`, oldValue: '', newValue: '+' + name, operator, remark: '新增成员' });
      else if (om[name] !== nm[name]) out.push({ reqId, entityType: 'stage', action: 'stage-edit', field: `${s}·${name}进度`, oldValue: om[name] + '%', newValue: nm[name] + '%', operator });
    });
    Object.keys(om).forEach(name => { if (!(name in nm)) out.push({ reqId, entityType: 'stage', action: 'stage-edit', field: `${s}·成员`, oldValue: name, newValue: '(移除)', operator, remark: '移除成员' }); });
  });
  return out;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const action = event.queryStringParameters?.action;

  try {
    await initTables();
    const pool = getPool();

    // ========== 生命周期：读取（单个需求） ==========
    if (action === "lifecycle") {
      const reqId = event.queryStringParameters?.req_id || "";
      if (!reqId) return err("缺少 req_id", 400);
      const [rows] = await pool.execute("SELECT * FROM req_lifecycle WHERE req_id=?", [reqId]);
      if (!rows.length) {
        return ok({ reqId, currentStage: STAGES[0], stages: defaultStages(), initialized: false });
      }
      const r = rows[0];
      return ok({ reqId, currentStage: r.current_stage || STAGES[0], stages: normStages(parseJson(r.stages, null)), initialized: true });
    }

    // ========== 生命周期：批量读取（用于列表标注） ==========
    if (action === "lifecycle-map") {
      const [rows] = await pool.execute("SELECT req_id,current_stage,stages,updated_at FROM req_lifecycle");
      const map = {};
      rows.forEach(r => { map[r.req_id] = { currentStage: r.current_stage || STAGES[0], stages: normStages(parseJson(r.stages, null)), updatedAt: r.updated_at }; });
      return ok(map);
    }

    // ========== 流转日志：单个需求时间线 ==========
    if (action === "log-list") {
      const reqId = event.queryStringParameters?.req_id || "";
      if (!reqId) return err("缺少 req_id", 400);
      const [rows] = await pool.execute("SELECT * FROM collab_flow_log WHERE req_id=? ORDER BY created_at ASC, id ASC", [reqId]);
      return ok(rows.map(r => ({ id: r.id, reqId: r.req_id, fromStage: r.from_stage || '', toStage: r.to_stage, operator: r.operator || '', remark: r.remark || '', createdAt: r.created_at })));
    }

    // ========== 卡点：单个需求 ==========
    if (action === "blockers-list") {
      const reqId = event.queryStringParameters?.req_id || "";
      let sql = "SELECT * FROM collab_blockers", params = [];
      if (reqId) { sql += " WHERE req_id=?"; params.push(reqId); }
      sql += " ORDER BY created_at DESC";
      const [rows] = await pool.execute(sql, params);
      return ok(rows.map(mapBlocker));
    }

    // ========== 认领留痕：单个需求时间线 ==========
    if (action === "claim-log-list") {
      const reqId = event.queryStringParameters?.req_id || "";
      if (!reqId) return err("缺少 req_id", 400);
      const [rows] = await pool.execute("SELECT * FROM collab_claim_log WHERE req_id=? ORDER BY created_at DESC, id DESC", [reqId]);
      return ok(rows.map(r => ({ id: r.id, reqId: r.req_id, action: r.action || '认领', persons: r.persons || '', operator: r.operator || '', remark: r.remark || '', createdAt: r.created_at })));
    }

    // ========== 操作留痕：单个需求的字段/阶段/卡点变更时间线 ==========
    if (action === "audit-list") {
      const reqId = event.queryStringParameters?.req_id || "";
      if (!reqId) return err("缺少 req_id", 400);
      const [rows] = await pool.execute("SELECT * FROM audit_log WHERE req_id=? ORDER BY created_at DESC, id DESC", [reqId]);
      return ok(rows.map(r => ({ id: r.id, reqId: r.req_id, entityType: r.entity_type, action: r.action, field: r.field || '', oldValue: r.old_value || '', newValue: r.new_value || '', operator: r.operator || '', source: r.source || 'manual', remark: r.remark || '', createdAt: r.created_at })));
    }

    // ========== 生命周期：一次性拉取详情所需全部数据（把详情的 5 次请求合成 1 次，显著减少高延迟公网往返） ==========
    if (action === "lifecycle-full") {
      const reqId = event.queryStringParameters?.req_id || "";
      if (!reqId) return err("缺少 req_id", 400);
      const [lifeRes, blkRes, logRes, claimRes, auditRes] = await Promise.all([
        pool.execute("SELECT * FROM req_lifecycle WHERE req_id=?", [reqId]),
        pool.execute("SELECT * FROM collab_blockers WHERE req_id=? ORDER BY created_at DESC", [reqId]),
        pool.execute("SELECT * FROM collab_flow_log WHERE req_id=? ORDER BY created_at ASC, id ASC", [reqId]),
        pool.execute("SELECT * FROM collab_claim_log WHERE req_id=? ORDER BY created_at DESC, id DESC", [reqId]),
        pool.execute("SELECT * FROM audit_log WHERE req_id=? ORDER BY created_at DESC, id DESC", [reqId])
      ]);
      const lr = lifeRes[0];
      const life = (lr && lr.length)
        ? { reqId, currentStage: lr[0].current_stage || STAGES[0], stages: normStages(parseJson(lr[0].stages, null)), initialized: true }
        : { reqId, currentStage: STAGES[0], stages: defaultStages(), initialized: false };
      const blockers = blkRes[0].map(mapBlocker);
      const logs = logRes[0].map(r => ({ id: r.id, reqId: r.req_id, fromStage: r.from_stage || '', toStage: r.to_stage, operator: r.operator || '', remark: r.remark || '', createdAt: r.created_at }));
      const claimLogs = claimRes[0].map(r => ({ id: r.id, reqId: r.req_id, action: r.action || '认领', persons: r.persons || '', operator: r.operator || '', remark: r.remark || '', createdAt: r.created_at }));
      const audit = auditRes[0].map(r => ({ id: r.id, reqId: r.req_id, entityType: r.entity_type, action: r.action, field: r.field || '', oldValue: r.old_value || '', newValue: r.new_value || '', operator: r.operator || '', source: r.source || 'manual', remark: r.remark || '', createdAt: r.created_at }));
      return ok({ life, blockers, logs, claimLogs, audit });
    }

    // ---------- 写操作 ----------
    const body = JSON.parse(event.body || "{}");

    // ========== 认领留痕：新增一条 ==========
    if (action === "claim-log-add") {
      const { reqId, action: act, persons, operator, remark } = body;
      if (!reqId) return err("缺少 reqId", 400);
      await pool.execute(
        "INSERT INTO collab_claim_log (req_id,action,persons,operator,remark) VALUES (?,?,?,?,?)",
        [reqId, act || "认领", persons || "", operator || "", remark || ""]
      );
      return ok({ ok: true });
    }

    // ========== 生命周期：保存（upsert 各阶段/当前阶段） ==========
    if (action === "lifecycle-save") {
      const { reqId, currentStage, stages, operator } = body;
      if (!reqId) return err("缺少 reqId", 400);
      const cs = STAGES.includes(currentStage) ? currentStage : STAGES[0];
      const newStages = normStages(stages);
      const [oldRows] = await pool.execute("SELECT stages FROM req_lifecycle WHERE req_id=?", [reqId]);
      const oldStages = oldRows.length ? normStages(parseJson(oldRows[0].stages, null)) : defaultStages();
      await pool.execute(
        `INSERT INTO req_lifecycle (req_id,current_stage,stages) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE current_stage=VALUES(current_stage), stages=VALUES(stages), updated_at=NOW()`,
        [reqId, cs, JSON.stringify(newStages)]
      );
      await logAudit(auditStageDiff(reqId, oldStages, newStages, operator));   // 阶段编辑留痕
      return ok({ ok: true });
    }

    // ========== 生命周期：推进阶段（含留痕） ==========
    if (action === "stage-advance") {
      const { reqId, toStage, operator, remark } = body;
      if (!reqId) return err("缺少 reqId", 400);
      if (!STAGES.includes(toStage)) return err("目标阶段无效", 400);
      const [rows] = await pool.execute("SELECT * FROM req_lifecycle WHERE req_id=?", [reqId]);
      let cur = rows.length ? (rows[0].current_stage || STAGES[0]) : STAGES[0];
      let stages = rows.length ? normStages(parseJson(rows[0].stages, null)) : defaultStages();
      const fromStage = cur;
      // 起点及其之前阶段标记已完成；目标阶段进行中
      const toIdx = STAGES.indexOf(toStage);
      STAGES.forEach((s, i) => {
        if (i < toIdx) { stages[s].status = '已完成'; stages[s].members = (stages[s].members || []).map(m => ({ name: m.name, progress: 100 })); }
        else if (i === toIdx) { if (stages[s].status === '未开始') stages[s].status = '进行中'; }
      });
      await pool.execute(
        `INSERT INTO req_lifecycle (req_id,current_stage,stages) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE current_stage=VALUES(current_stage), stages=VALUES(stages), updated_at=NOW()`,
        [reqId, toStage, JSON.stringify(stages)]
      );
      await pool.execute(
        "INSERT INTO collab_flow_log (req_id,from_stage,to_stage,operator,remark) VALUES (?,?,?,?,?)",
        [reqId, fromStage, toStage, operator || "", remark || ""]
      );
      return ok({ ok: true });
    }

    // ========== 卡点：新增 ==========
    if (action === "blockers-add") {
      const { reqId, dept, stage, description, impact, occurredAt, resourcesNeeded, expectedResolveAt, follower, progressNote, status } = body;
      if (!reqId) return err("缺少 reqId", 400);
      if (!description) return err("卡点描述不能为空", 400);
      if (!follower) return err("处理人不能为空", 400);
      const id = genId("cb_");
      await pool.execute(
        `INSERT INTO collab_blockers
          (id,req_id,dept,stage,description,impact,occurred_at,resources_needed,expected_resolve_at,follower,progress_note,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, reqId, dept || "", stage || "", description, impact || "", toDate(occurredAt),
         resourcesNeeded || "", toDate(expectedResolveAt), follower || "", progressNote || "", status || "待处理"]
      );
      await logAudit({ reqId, entityType: "blocker", action: "blocker-add", operator: body.operator, remark: (dept ? dept + " " : "") + description + " · 处理人:" + (follower || "") });
      return ok({ ok: true, id });
    }

    // ========== 卡点：更新 ==========
    if (action === "blockers-update") {
      const { id, dept, stage, description, impact, occurredAt, resourcesNeeded, expectedResolveAt, follower, progressNote, status } = body;
      if (!id) return err("缺少 id", 400);
      if (!description) return err("卡点描述不能为空", 400);
      if (!follower) return err("处理人不能为空", 400);
      const [brows] = await pool.execute("SELECT req_id,status FROM collab_blockers WHERE id=?", [id]);
      await pool.execute(
        `UPDATE collab_blockers SET
          dept=?,stage=?,description=?,impact=?,occurred_at=?,resources_needed=?,expected_resolve_at=?,follower=?,progress_note=?,status=?,updated_at=NOW()
         WHERE id=?`,
        [dept || "", stage || "", description, impact || "", toDate(occurredAt),
         resourcesNeeded || "", toDate(expectedResolveAt), follower || "", progressNote || "", status || "待处理", id]
      );
      const old = brows[0] || {};
      const stChg = (old.status || "") !== (status || "待处理") ? `状态 ${old.status || ""}→${status || "待处理"} · ` : "";
      await logAudit({ reqId: old.req_id || "", entityType: "blocker", action: "blocker-update", operator: body.operator, remark: stChg + description });
      return ok({ ok: true });
    }

    // ========== 卡点：删除 ==========
    if (action === "blockers-delete") {
      const { id } = body;
      if (!id) return err("缺少 id", 400);
      const [brows] = await pool.execute("SELECT req_id,description FROM collab_blockers WHERE id=?", [id]);
      await pool.execute("DELETE FROM collab_blockers WHERE id=?", [id]);
      const old = brows[0] || {};
      await logAudit({ reqId: old.req_id || "", entityType: "blocker", action: "blocker-delete", operator: body.operator, remark: old.description || "" });
      return ok({ ok: true });
    }

    return err("未知操作: " + action, 400);
  } catch (e) {
    console.error("[collab] error:", e);
    return err(e.message);
  }
};
