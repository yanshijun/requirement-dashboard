const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = "yanshijun";
const GITHUB_REPO = "requirement-dashboard";
const GITHUB_FILE = "data/requirements.json";

const APP_ID = "cli_a9255b106cf81bc8";
const APP_SECRET = "fYyAEs7wOH3UsU8SJgmemdIwtV6Iv5dw";
const APP_TOKEN = "XCgIb7NnwaAQq3sf1mjcQtdyned";
const TABLE_ID = "tblgnpLLYI2JGQH0";
const BASE = "https://open.feishu.cn/open-apis";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

const ghHeaders = {
  "Authorization": `Bearer ${GITHUB_TOKEN}`,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json"
};

async function readGithubData() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
    headers: ghHeaders
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`读取GitHub失败: ${res.status}`);
  const json = await res.json();
  return JSON.parse(Buffer.from(json.content, "base64").toString("utf-8"));
}

async function getFeishuToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error("飞书Token获取失败");
  return data.tenant_access_token;
}

async function clearFeishuTable(token) {
  let pageToken = "", ids = [];
  do {
    const url = `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500${pageToken ? "&page_token=" + pageToken : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    if (data.code !== 0) throw new Error("读取飞书失败: " + JSON.stringify(data));
    ids = ids.concat((data.data.items || []).map(r => r.record_id));
    pageToken = data.data.has_more ? data.data.page_token : "";
  } while (pageToken);

  for (let i = 0; i < ids.length; i += 500) {
    const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_delete`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ records: ids.slice(i, i + 500) })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error("删除飞书记录失败");
  }
}

async function writeFeishuRecords(token, items) {
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
    const items = await readGithubData();
    if (items.length === 0) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, message: "暂无数据", count: 0 }) };

    const token = await getFeishuToken();
    await clearFeishuTable(token);
    await writeFeishuRecords(token, items);

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, message: `成功同步 ${items.length} 条需求到飞书`, count: items.length }) };
  } catch (e) {
    console.error("sync-feishu error:", e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};