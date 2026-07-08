// 一次性迁移：把飞书里的 需求 / 今日收集(反馈) / 排班 + 三处附件 迁到 MySQL。
// 用法：node scripts/migrate-feishu-to-db.js
// 特性：保留飞书 record_id 作主键（续接生命周期/卡点/反馈关联）；幂等可重复运行（ON DUPLICATE KEY UPDATE）。
// 结构化读取直接复用 netlify/functions/feishu.js 的 handler，保证映射逻辑与线上完全一致。

const { getPool, initTables } = require('../netlify/functions/db');
const feishu = require('../netlify/functions/feishu');

// —— 飞书凭据（与 feishu.js 保持一致，仅附件下载用）——
const APP_ID = process.env.FEISHU_APP_ID || "cli_a9255b106cf81bc8";
const APP_SECRET = process.env.FEISHU_SECRET || "fYyAEs7wOH3UsU8SJgmemdIwtV6Iv5dw";
const BASE = "https://open.feishu.cn/open-apis";

let _token = null;
async function feishuToken() {
  if (_token) return _token;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error("获取飞书Token失败: " + JSON.stringify(data));
  _token = data.tenant_access_token;
  return _token;
}

// 调 feishu.js handler 取已映射好的数据
async function feishuGet(params) {
  const r = await feishu.handler({ httpMethod: "GET", queryStringParameters: params });
  if (r.statusCode !== 200) throw new Error(`飞书读取失败(${JSON.stringify(params)}): ${r.body}`);
  return JSON.parse(r.body);
}

async function checkConnectivity() {
  process.stdout.write("· 检查 MySQL 连通性… ");
  await getPool().query("SELECT 1");
  console.log("OK");
  process.stdout.write("· 检查飞书连通性… ");
  await feishuToken();
  console.log("OK");
}

// ============ 结构化数据迁移 ============
async function migrateRequirements(pool) {
  const { requirements } = await feishuGet({ table: "all" });
  const cols = ["id","req_no","name","description","req_type","plan","priority","status","progress","person","deadline","design","review","create_time","submitter","note","parent_id","attachments"];
  const upd = cols.filter(c => c !== "id").map(c => `${c}=VALUES(${c})`).join(",");
  const sql = `INSERT INTO reqs (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")}) ON DUPLICATE KEY UPDATE ${upd}`;
  for (const r of requirements) {
    await pool.query(sql, [
      r.id, String(r.no||""), String(r.name||""), String(r.desc||""), String(r.type||"用户需求"),
      String(r.plan||""), String(r.priority||""), String(r.status||"待开始"),
      Math.max(0, Math.min(100, Math.round(parseInt(r.progress)||0))),
      String(r.person||""), String(r.deadline||""), String(r.design||""), String(r.review||""),
      String(r.createTime||""), String(r.submitter||""), String(r.note||""), String(r.parentId||""),
      JSON.stringify(Array.isArray(r.attachments)?r.attachments:[])
    ]);
  }
  console.log(`✓ 需求 requirements: ${requirements.length} 条`);
  return requirements;
}

async function migrateFeedback(pool) {
  const { feedback } = await feishuGet({ table: "all" });
  const cols = ["id","title","source","priority","reporter","customer_id","description","note","status","create_time","req_id"];
  const upd = cols.filter(c => c !== "id").map(c => `${c}=VALUES(${c})`).join(",");
  const sql = `INSERT INTO feedback (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")}) ON DUPLICATE KEY UPDATE ${upd}`;
  for (const f of feedback) {
    await pool.query(sql, [
      f.id, String(f.title||""), String(f.source||"其他"), String(f.priority||"中🟡"),
      String(f.reporter||""), String(f.customerId||""), String(f.desc||""), String(f.note||""),
      String(f.status||"待跟进"), String(f.createTime||""), String(f.reqId||"")
    ]);
  }
  console.log(`✓ 今日收集 feedback: ${feedback.length} 条`);
}

async function migrateSchedule(pool) {
  const schedule = await feishuGet({ table: "schedule" });
  const cols = ["id","date_str","weekday","group_name","on_duty","backup"];
  const upd = cols.filter(c => c !== "id").map(c => `${c}=VALUES(${c})`).join(",");
  const sql = `INSERT INTO schedule (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")}) ON DUPLICATE KEY UPDATE ${upd}`;
  for (const s of schedule) {
    await pool.query(sql, [s.id, String(s.date||""), String(s.weekday||""), String(s.group||""), String(s.onDuty||""), String(s.backup||"")]);
  }
  console.log(`✓ 排班 schedule: ${schedule.length} 条`);
}

// ============ 附件字节迁移 ============
function collectTokens(arr, out) {
  (Array.isArray(arr) ? arr : []).forEach(a => { if (a && a.file_token) out.add(a.file_token); });
}
async function migrateAttachments(pool, requirements) {
  const tokens = new Set();
  requirements.forEach(r => collectTokens(r.attachments, tokens));
  // 问题(kb_issues) / Bug(innovation_bugs, requirement_bugs) 的附件 file_token
  for (const t of ["kb_issues", "innovation_bugs", "requirement_bugs"]) {
    try {
      const [rows] = await pool.query(`SELECT attachments FROM ${t}`);
      rows.forEach(row => {
        let att = row.attachments;
        if (typeof att === "string") { try { att = JSON.parse(att); } catch (e) { att = []; } }
        collectTokens(att, tokens);
      });
    } catch (e) { console.log(`  (跳过 ${t}: ${e.message})`); }
  }
  // 已迁过的跳过
  const [existRows] = await pool.query("SELECT token FROM attachments");
  const exist = new Set(existRows.map(r => r.token));
  const todo = [...tokens].filter(t => t && !exist.has(t));
  console.log(`· 附件 token 共 ${tokens.size} 个，待下载 ${todo.length} 个（已存在 ${exist.size}）`);

  let done = 0, fail = 0;
  const token = await feishuToken();
  for (const ft of todo) {
    try {
      const res = await fetch(`${BASE}/drive/v1/medias/${ft}/download`, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) { fail++; console.log(`  ✗ ${ft} HTTP ${res.status}`); continue; }
      const ct = res.headers.get("content-type") || "application/octet-stream";
      const buf = Buffer.from(await res.arrayBuffer());
      await pool.query(
        "INSERT INTO attachments (token,filename,mimetype,data,size) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),mimetype=VALUES(mimetype),size=VALUES(size)",
        [ft, "", ct, buf.toString("base64"), buf.length]
      );
      done++;
      if (done % 20 === 0) console.log(`  …已下载 ${done}/${todo.length}`);
    } catch (e) { fail++; console.log(`  ✗ ${ft} ${e.message}`); }
  }
  console.log(`✓ 附件迁移完成：成功 ${done}，失败 ${fail}`);
}

async function main() {
  console.log("=== 飞书 → MySQL 迁移开始 ===");
  await initTables();
  const pool = getPool();
  await checkConnectivity();
  console.log("--- 结构化数据 ---");
  const requirements = await migrateRequirements(pool);
  await migrateFeedback(pool);
  await migrateSchedule(pool);
  console.log("--- 附件字节 ---");
  await migrateAttachments(pool, requirements);
  // 校验计数
  const [[[rc]], [[fc]], [[sc]], [[ac]]] = await Promise.all([
    pool.query("SELECT COUNT(*) c FROM reqs"),
    pool.query("SELECT COUNT(*) c FROM feedback"),
    pool.query("SELECT COUNT(*) c FROM schedule"),
    pool.query("SELECT COUNT(*) c FROM attachments")
  ]);
  console.log(`=== 完成：reqs=${rc.c} feedback=${fc.c} schedule=${sc.c} attachments=${ac.c} ===`);
  await pool.end();
}

main().catch(e => { console.error("迁移失败:", e); process.exit(1); });
