const { getPool, initTables } = require('./db');

const APP_ID = "cli_a9255b106cf81bc8";
const APP_SECRET = process.env.FEISHU_SECRET || "fYyAEs7wOH3UsU8SJgmemdIwtV6Iv5dw";
const APP_TOKEN_ISS = "LdVobWw4BaVcsms2ZHdcL2Ccnyg";
const TABLE_ID_ISS = "tblsSPrURo45Yr2h";

const QWEN_API_KEY = process.env.QWEN_API_KEY || "sk-09dc3da40982446fba3fae80042ab42c";
const QWEN_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const QWEN_MODEL = "qwen3.5-plus";
const EMBED_MODEL = "text-embedding-v3";
const BASE = "https://open.feishu.cn/open-apis";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }

// ===== 飞书 =====
async function getFeishuToken() {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const d = await r.json();
  if (!d.tenant_access_token) throw new Error("获取飞书 token 失败");
  return d.tenant_access_token;
}

async function getAllFeishuRecords(token) {
  let records = [], pageToken = "";
  do {
    const url = `${BASE}/bitable/v1/apps/${APP_TOKEN_ISS}/tables/${TABLE_ID_ISS}/records?page_size=500${pageToken ? "&page_token=" + pageToken : ""}`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    const d = await r.json();
    if (d.code !== 0) throw new Error("拉取飞书记录失败: " + JSON.stringify(d));
    records = records.concat(d.data.items || []);
    pageToken = d.data.has_more ? d.data.page_token : "";
  } while (pageToken);
  return records;
}

// ===== Embedding =====
async function getEmbeddings(texts) {
  const res = await fetch(`${QWEN_BASE}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + QWEN_API_KEY },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, encoding_format: "float" })
  });
  const data = await res.json();
  if (!data.data) throw new Error("Embedding 失败: " + JSON.stringify(data));
  return data.data.map(d => d.embedding);
}

// ===== 向量相似度 =====
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ===== Qwen =====
async function callQwen(cases, query) {
  const withSolution = cases.filter(c => c.solution);
  const caseText = cases.map((c, i) => {
    const lines = [`--- 案例${i + 1} (${c.package_type || "未知套餐"}) ---`, `问题：${c.desc_text}`];
    if (c.solution) lines.push(`★ 解决方案：${c.solution}`);
    if (c.tags) lines.push(`标签：${c.tags}`);
    return lines.join("\n");
  }).join("\n\n");

  const hasSolution = withSolution.length > 0;
  const userPrompt = `【用户问题】\n${query}\n\n【知识库历史案例】\n${caseText || "（暂无匹配案例）"}\n\n【回复要求】\n${
    hasSolution
      ? "以上案例中标注「★ 解决方案」的内容是真实处理记录，你必须以此为核心回复，不得替换为其他方案。输出：\n1. 处理步骤（直接基于解决方案）\n2. 可发给客户的话术"
      : "历史案例中暂无解决方案，请根据问题描述给出建议，并注明'历史案例参考有限，建议人工确认'。"
  }`;

  const res = await fetch(`${QWEN_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + QWEN_API_KEY },
    body: JSON.stringify({
      model: QWEN_MODEL,
      enable_thinking: false,
      messages: [
        { role: "system", content: "你是专业的客服售后助手，处理 SaaS 产品客户问题。严格基于提供的历史案例回复，不编造信息。回复简洁专业。" },
        { role: "user", content: userPrompt }
      ],
      stream: false
    })
  });
  const data = await res.json();
  if (!data.choices?.[0]) throw new Error("Qwen 返回异常: " + JSON.stringify(data));
  let answer = data.choices[0].message.content || "";
  answer = answer.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { answer, inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 };
}

// ===== 主处理 =====
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;

  try {
    await initTables();
    const pool = getPool();

    // 同步飞书 → MySQL + 生成 Embedding
    if (action === "kb-sync") {
      const feishuToken = await getFeishuToken();
      const records = await getAllFeishuRecords(feishuToken);
      let added = 0, updated = 0, skipped = 0;

      // 分批处理，每批 20 条
      const BATCH = 10;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const toEmbed = [];
        const parsed = batch.map(r => {
          const f = r.fields || {};
          return {
            id: r.record_id,
            date_str: String(f["日期"] || ""),
            package_type: String(f["套餐类型"] || ""),
            desc_text: String(f["问题描述"] || ""),
            solution: String(f["解决方案"] || ""),
            tags: String(f["问题标签"] || ""),
            status: String(f["处理状态"] || ""),
            in_kb: f["是否入库"] !== false ? 1 : 0
          };
        });

        // 检查哪些需要更新 embedding
        for (const item of parsed) {
          const [rows] = await pool.execute("SELECT id, desc_text, solution FROM kb_issues WHERE id = ?", [item.id]);
          const existing = rows[0];
          if (!existing) {
            toEmbed.push(item);
          } else if (existing.desc_text !== item.desc_text || existing.solution !== item.solution) {
            toEmbed.push(item);
          } else {
            // 只更新非 embedding 字段
            await pool.execute(
              "UPDATE kb_issues SET date_str=?, package_type=?, tags=?, status=?, in_kb=?, updated_at=NOW() WHERE id=?",
              [item.date_str, item.package_type, item.tags, item.status, item.in_kb, item.id]
            );
            skipped++;
          }
        }

        if (toEmbed.length > 0) {
          const texts = toEmbed.map(item => `${item.desc_text} ${item.solution} ${item.tags}`.trim());
          const embeddings = await getEmbeddings(texts);
          for (let j = 0; j < toEmbed.length; j++) {
            const item = toEmbed[j];
            const embJson = JSON.stringify(embeddings[j]);
            const [existing] = await pool.execute("SELECT id FROM kb_issues WHERE id = ?", [item.id]);
            if (existing.length > 0) {
              await pool.execute(
                "UPDATE kb_issues SET date_str=?,package_type=?,desc_text=?,solution=?,tags=?,status=?,in_kb=?,embedding=?,updated_at=NOW() WHERE id=?",
                [item.date_str, item.package_type, item.desc_text, item.solution, item.tags, item.status, item.in_kb, embJson, item.id]
              );
              updated++;
            } else {
              await pool.execute(
                "INSERT INTO kb_issues (id,date_str,package_type,desc_text,solution,tags,status,in_kb,embedding) VALUES (?,?,?,?,?,?,?,?,?)",
                [item.id, item.date_str, item.package_type, item.desc_text, item.solution, item.tags, item.status, item.in_kb, embJson]
              );
              added++;
            }
          }
        }
      }

      const [countRows] = await pool.execute("SELECT COUNT(*) as total FROM kb_issues WHERE in_kb=1");
      return ok({ ok: true, added, updated, skipped, total: countRows[0].total });
    }

    // AI 问答
    if (action === "kb-ask") {
      const body = JSON.parse(event.body || "{}");
      const { query, sessionId, user } = body;
      if (!query) return err("缺少 query", 400);

      // 生成查询向量
      const [queryEmb] = await getEmbeddings([query]);

      // 从 MySQL 拉取所有有 embedding 的记录
      const [rows] = await pool.execute(
        "SELECT id, date_str, package_type, desc_text, solution, tags, status, embedding FROM kb_issues WHERE in_kb=1 AND embedding IS NOT NULL"
      );

      // 计算相似度，取 Top 5
      const scored = rows
        .map(row => {
          const emb = JSON.parse(row.embedding || "[]");
          return { ...row, score: cosineSimilarity(queryEmb, emb) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .filter(r => r.score > 0.3); // 相似度阈值

      console.log(`[kb-ask] 查询: "${query}", 匹配 ${scored.length} 条, top score: ${scored[0]?.score?.toFixed(3)}`);

      const { answer, inputTokens, outputTokens } = await callQwen(scored, query);

      // 保存对话记录
      const sid = sessionId || ("sess_" + Date.now());
      await pool.execute(
        "INSERT INTO kb_chats (session_id, query_text, answer_text, used_cases, user_name) VALUES (?,?,?,?,?)",
        [sid, query, answer, scored.length, user || "匿名"]
      );

      return ok({
        answer,
        usedCases: scored.length,
        cases: scored.map(r => ({ date: r.date_str, packageType: r.package_type, desc: r.desc_text, solution: r.solution, score: r.score })),
        sessionId: sid,
        inputTokens,
        outputTokens
      });
    }

    // 对话历史
    if (action === "kb-history") {
      const body = JSON.parse(event.body || "{}");
      const { sessionId } = body;
      if (!sessionId) return err("缺少 sessionId", 400);
      const [rows] = await pool.execute(
        "SELECT query_text, answer_text, created_at FROM kb_chats WHERE session_id=? ORDER BY created_at ASC LIMIT 50",
        [sessionId]
      );
      return ok({ history: rows.map(r => ({ query: r.query_text, answer: r.answer_text, time: r.created_at })) });
    }

    // 知识库状态
    if (action === "kb-status") {
      const [total] = await pool.execute("SELECT COUNT(*) as n FROM kb_issues WHERE in_kb=1");
      const [withEmb] = await pool.execute("SELECT COUNT(*) as n FROM kb_issues WHERE in_kb=1 AND embedding IS NOT NULL");
      const [lastSync] = await pool.execute("SELECT MAX(updated_at) as t FROM kb_issues");
      return ok({ total: total[0].n, withEmbedding: withEmb[0].n, lastSync: lastSync[0].t });
    }

    // ===== 问题记录 CRUD =====

    if (action === "iss-list") {
      const [rows] = await pool.execute(
        "SELECT id, date_str, customer_id, package_type, desc_text, solution, tags, status, person, in_kb, attachments FROM kb_issues ORDER BY created_at DESC"
      );
      const items = rows.map(r => ({
        id: r.id,
        date: r.date_str,
        customerId: r.customer_id,
        packageType: r.package_type,
        desc: r.desc_text,
        solution: r.solution,
        tags: r.tags,
        status: r.status,
        person: r.person,
        inKb: r.in_kb === 1,
        attachments: Array.isArray(r.attachments) ? r.attachments : (() => { try { return JSON.parse(r.attachments || '[]'); } catch(e) { return []; } })()
      }));
      return ok(items);
    }

    if (action === "iss-add") {
      const body = JSON.parse(event.body || "{}");
      const { date, customerId, packageType, desc, solution, tags, status, person, inKb, attachments } = body;
      console.log('[iss-add] attachments received:', JSON.stringify(attachments));
      if (!desc) return err("缺少问题描述", 400);
      const id = "iss_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const embText = `${desc} ${solution || ""} ${tags || ""}`.trim();
      const [emb] = await getEmbeddings([embText]);
      await pool.execute(
        "INSERT INTO kb_issues (id,date_str,customer_id,package_type,desc_text,solution,tags,status,person,in_kb,attachments,embedding) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, date || "", customerId || "", packageType || "", desc, solution || "", tags || "", status || "未解决", person || "", inKb !== false ? 1 : 0, JSON.stringify(attachments || []), JSON.stringify(emb)]
      );
      return ok({ ok: true, id });
    }

    if (action === "iss-update") {
      const body = JSON.parse(event.body || "{}");
      const { id, date, customerId, packageType, desc, solution, tags, status, person, inKb, attachments } = body;
      if (!id) return err("缺少 id", 400);
      const [old] = await pool.execute("SELECT desc_text, solution, tags FROM kb_issues WHERE id=?", [id]);
      let embJson = null;
      const needReEmbed = !old[0] || old[0].desc_text !== desc || old[0].solution !== (solution || "") || old[0].tags !== (tags || "");
      if (needReEmbed) {
        const embText = `${desc} ${solution || ""} ${tags || ""}`.trim();
        const [emb] = await getEmbeddings([embText]);
        embJson = JSON.stringify(emb);
      }
      const sql = embJson
        ? "UPDATE kb_issues SET date_str=?,customer_id=?,package_type=?,desc_text=?,solution=?,tags=?,status=?,person=?,in_kb=?,attachments=?,embedding=?,updated_at=NOW() WHERE id=?"
        : "UPDATE kb_issues SET date_str=?,customer_id=?,package_type=?,desc_text=?,solution=?,tags=?,status=?,person=?,in_kb=?,attachments=?,updated_at=NOW() WHERE id=?";
      const params = embJson
        ? [date || "", customerId || "", packageType || "", desc, solution || "", tags || "", status || "未解决", person || "", inKb !== false ? 1 : 0, JSON.stringify(attachments || []), embJson, id]
        : [date || "", customerId || "", packageType || "", desc, solution || "", tags || "", status || "未解决", person || "", inKb !== false ? 1 : 0, JSON.stringify(attachments || []), id];
      await pool.execute(sql, params);
      return ok({ ok: true });
    }

    if (action === "iss-delete") {
      const body = JSON.parse(event.body || "{}");
      const { id } = body;
      if (!id) return err("缺少 id", 400);
      await pool.execute("DELETE FROM kb_issues WHERE id=?", [id]);
      return ok({ ok: true });
    }

    return err("未知操作", 400);
  } catch (e) {
    console.error("[kb] error:", e);
    return err(e.message);
  }
};
