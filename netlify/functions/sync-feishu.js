const { getStore } = require("@netlify/blobs");

// ===== 飞书配置 =====
const APP_ID = "cli_a9255b106cf81bc8";
const APP_SECRET = "fYyAEs7wOH3UsV8SJgmemdIwtV6Iv5dw"; // 建议放环境变量
const APP_TOKEN = "XCgIb7NnwaAQq3sf1mjcQtdyned";
const TABLE_ID = "tblgnpLLYI2JGQH0";

const BASE = "https://open.feishu.cn/open-apis";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// 获取飞书 token
async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error("飞书Token获取失败: " + JSON.stringify(data));
  return data.tenant_access_token;
}

// 清空飞书表格所有记录
async function clearTable(token) {
  let pageToken = "";
  let ids = [];
  do {
    const url = `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500${pageToken ? "&page_token=" + pageToken : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    if (data.code !== 0) throw new Error("读取飞书数据失败: " + JSON.stringify(data));
    ids = ids.concat((data.data.items || []).map(r => r.record_id));
    pageToken = data.data.has_more ? data.data.page_token : "";
  } while (pageToken);

  // 批量删除（每次最多500条）
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_delete`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error("删除飞书记录失败: " + JSON.stringify(data));
  }
}

// 批量写入飞书
async function writeRecords(token, items) {
  // 每批最多500条
  for (let i = 0; i < items.length; i += 500) {
    const batch = items.slice(i, i + 500).map(d => ({
      fields: {
        "需求编号": d.no || "",
        "需求名称": d.name || "",
        "需求描述": d.desc || "",
        "需求类型": d.type || "",
        "所属计划": d.plan || "",
        "优先级": d.priority || "",
        "开发状态": d.status || "待开始",
        "开发进度": String(d.progress || 0) + "%",
        "需求认领人": d.person || "",
        "预计上线日期": d.deadline || "",
        "是否需要设计": d.design || "",
        "评审是否通过": d.review || "",
        "提出时间": d.createTime || "",
        "备注": d.note || ""
      }
    }));

    const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_create`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error("写入飞书失败: " + JSON.stringify(data));
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method Not Allowed" }) };

  try {
    // 1. 从 Netlify Blobs 读取看板数据
    const store = getStore("requirements");
    const raw = await store.get("all");
    const items = raw ? JSON.parse(raw) : [];

    if (items.length === 0) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, message: "暂无数据可同步", count: 0 }) };
    }

    // 2. 获取飞书 token
    const token = await getToken();

    // 3. 清空旧数据
    await clearTable(token);

    // 4. 写入新数据
    await writeRecords(token, items);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, message: `成功同步 ${items.length} 条需求到飞书`, count: items.length })
    };
  } catch (e) {
    console.error("sync-feishu error:", e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};