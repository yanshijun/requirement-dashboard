const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = "yanshijun";
const GITHUB_REPO = "requirement-dashboard";
const GITHUB_FILE = "data/requirements.json";
const API_BASE = "https://api.github.com";

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

function ok(data) {
  return { statusCode: 200, headers: cors, body: JSON.stringify(data) };
}
function err(msg, code = 500) {
  return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) };
}

// 读取 GitHub 文件，返回 { data, sha }
async function readFile() {
  const res = await fetch(`${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
    headers: ghHeaders
  });
  if (res.status === 404) return { data: [], sha: null };
  if (!res.ok) throw new Error(`读取失败: ${res.status}`);
  const json = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { data: JSON.parse(content), sha: json.sha };
}

// 写入 GitHub 文件
async function writeFile(data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
  const body = {
    message: `update requirements [${new Date().toLocaleString("zh-CN")}]`,
    content,
    ...(sha ? { sha } : {})
  };
  const res = await fetch(`${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
    method: "PUT",
    headers: ghHeaders,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(`写入失败: ${JSON.stringify(e)}`);
  }
}

function cleanItem(item, id) {
  return {
    id: id || String(Date.now()),
    no: String(item.no || ""),
    name: String(item.name || "").substring(0, 200),
    desc: String(item.desc || "").substring(0, 3000),
    type: String(item.type || "用户需求"),
    plan: String(item.plan || "SAE2.3.3"),
    priority: String(item.priority || "中🟡"),
    status: String(item.status || "待开始"),
    progress: Math.min(100, Math.max(0, parseInt(item.progress) || 0)),
    person: String(item.person || ""),
    deadline: String(item.deadline || ""),
    design: String(item.design || "待设计"),
    review: String(item.review || "待确认"),
    note: String(item.note || "").substring(0, 500),
    createTime: String(item.createTime || new Date().toLocaleDateString("zh-CN"))
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  try {
    // GET：读取所有需求
    if (event.httpMethod === "GET") {
      const { data } = await readFile();
      return ok(data);
    }

    if (event.httpMethod !== "POST") return err("Method Not Allowed", 405);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch (e) { return err("请求体格式错误", 400); }

    const action = event.queryStringParameters?.action;
    const { data, sha } = await readFile();

    // 新增
    if (action === "add") {
      if (!body.name) return err("需求名称不能为空", 400);
      const item = cleanItem(body, String(Date.now()));
      data.unshift(item);
      await writeFile(data, sha);
      return ok({ ok: true, item });
    }

    // 更新
    if (action === "update") {
      if (!body.id) return err("缺少需求ID", 400);
      const idx = data.findIndex(d => d.id === body.id);
      if (idx === -1) return err("未找到该需求", 404);
      data[idx] = cleanItem({ ...data[idx], ...body }, data[idx].id);
      await writeFile(data, sha);
      return ok({ ok: true });
    }

    // 删除
    if (action === "delete") {
      if (!body.id) return err("缺少需求ID", 400);
      const filtered = data.filter(d => d.id !== body.id);
      await writeFile(filtered, sha);
      return ok({ ok: true });
    }

    // 批量导入
    if (action === "import") {
      const items = Array.isArray(body) ? body : [];
      if (items.length === 0) return err("导入数据为空", 400);
      const ts = Date.now();
      const imported = items.map((item, i) => cleanItem(item, String(ts + i)));
      await writeFile(imported, sha);
      return ok({ ok: true, count: imported.length });
    }

    return err("未知操作: " + action, 400);

  } catch (e) {
    console.error("api error:", e);
    return err(e.message);
  }
};