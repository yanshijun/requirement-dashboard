const APP_ID = "cli_a9255b106cf81bc8";
const APP_SECRET = process.env.FEISHU_SECRET || "fYyAEs7wOH3UsU8SJgmemdIwtV6Iv5dw";
const APP_TOKEN = "XCgIb7NnwaAQq3sf1mjcQtdyned";
const TABLE_ID = "tblgnpLLYI2JGQH0";
const BASE = "https://open.feishu.cn/open-apis";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function ok(data) {
  return { statusCode: 200, headers: cors, body: JSON.stringify(data) };
}
function err(msg, code = 500) {
  return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) };
}

// 日期字符串/时间戳 → 飞书时间戳（毫秒整数）
function toFeishuDate(val) {
  if (!val) return null;
  if (typeof val === "number") return val;
  const ts = new Date(val).getTime();
  return isNaN(ts) ? null : ts;
}

// 飞书时间戳 → 日期字符串 YYYY-MM-DD
function fromFeishuDate(val) {
  if (!val) return "";
  try {
    const d = new Date(typeof val === "number" ? val : parseInt(val));
    if (isNaN(d.getTime())) return String(val);
    return d.toISOString().split("T")[0];
  } catch (e) {
    return String(val);
  }
}

// 获取飞书 token
async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error("获取飞书Token失败: " + JSON.stringify(data));
  return data.tenant_access_token;
}

// 读取飞书所有记录
async function getAllRecords(token) {
  let records = [], pageToken = "";
  do {
    const url = `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=500${pageToken ? "&page_token=" + pageToken : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    if (data.code !== 0) throw new Error("读取飞书记录失败: " + JSON.stringify(data));
    records = records.concat(data.data.items || []);
    pageToken = data.data.has_more ? data.data.page_token : "";
  } while (pageToken);
  return records;
}

// 从飞书单选/下拉字段安全取值
function getSingleSelect(val) {
  if (!val) return "";
  // 飞书单选返回格式可能是 { text: "xxx" } 或直接字符串
  if (typeof val === "object" && val.text) return String(val.text);
  return String(val);
}

// 飞书字段 → 看板字段
function mapFromFeishu(record) {
  const f = record.fields || {};
  // 进度条字段：飞书返回 0~1 的小数 或 0~100 整数，统一转成 0~100 整数
  let progress = 0;
  if (f["开发进度"] !== undefined && f["开发进度"] !== null) {
    const raw = parseFloat(f["开发进度"]);
    // 飞书进度条存的是 0~1 小数
    progress = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
  }
  return {
    id: record.record_id,
    no: String(f["需求编号"] || ""),
    name: String(f["需求名称"] || ""),
    desc: String(f["需求描述"] || ""),
    type: String(f["需求类型"] || "用户需求"),
    plan: getSingleSelect(f["所属计划"]),
    priority: getSingleSelect(f["优先级"]),
    status: getSingleSelect(f["开发状态"]),
    progress,
    person: getSingleSelect(f["需求认领人"]),
    deadline: fromFeishuDate(f["预计上线日期"]),
    design: getSingleSelect(f["是否需要设计"]),
    review: getSingleSelect(f["评审是否通过"]),
    createTime: fromFeishuDate(f["提出时间"]),
    note: String(f["备注"] || "")
  };
}

// 看板字段 → 飞书字段
function mapToFeishu(item) {
  const fields = {
    "需求编号": String(item.no || ""),
    "需求名称": String(item.name || ""),
    "需求描述": String(item.desc || ""),
    "需求类型": String(item.type || ""),
    // 下拉（单选）字段：直接传字符串
    "所属计划": String(item.plan || ""),
    "优先级": String(item.priority || ""),
    "开发状态": String(item.status || "待开始"),
    // 进度条字段：飞书要求传 0~1 小数
    "开发进度": Math.round(parseInt(item.progress || 0)) / 100,
    "需求认领人": String(item.person || ""),
    "是否需要设计": String(item.design || ""),
    "评审是否通过": String(item.review || ""),
    "备注": String(item.note || "")
  };
  // 日期字段：有值才传，且必须是时间戳（毫秒）
  const deadline = toFeishuDate(item.deadline);
  if (deadline) fields["预计上线日期"] = deadline;
  const createTime = toFeishuDate(item.createTime);
  if (createTime) fields["提出时间"] = createTime;
  return fields;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;

  try {
    const token = await getToken();

    // ===== GET：读取所有需求 =====
    if (event.httpMethod === "GET") {
      const records = await getAllRecords(token);
      const data = records.map(mapFromFeishu);
      return ok(data);
    }

    if (event.httpMethod !== "POST") return err("Method Not Allowed", 405);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch (e) { return err("请求格式错误", 400); }

    // ===== 新增 =====
    if (action === "add") {
      if (!body.name) return err("需求名称不能为空", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToFeishu(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("新增失败: " + JSON.stringify(data));
      return ok({ ok: true, item: mapFromFeishu(data.data.record) });
    }

    // ===== 更新 =====
    if (action === "update") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${body.id}`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToFeishu(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("更新失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 删除 =====
    if (action === "delete") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${body.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token }
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("删除失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 批量导入 =====
    if (action === "import") {
      const items = Array.isArray(body) ? body : [];
      if (!items.length) return err("数据为空", 400);
      // 清空旧数据
      const old = await getAllRecords(token);
      for (let i = 0; i < old.length; i += 500) {
        const ids = old.slice(i, i + 500).map(r => r.record_id);
        await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_delete`, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ records: ids })
        });
      }
      // 批量写入
      for (let i = 0; i < items.length; i += 500) {
        const batch = items.slice(i, i + 500).map(item => ({ fields: mapToFeishu(item) }));
        const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_create`, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ records: batch })
        });
        const data = await res.json();
        if (data.code !== 0) throw new Error("批量写入失败: " + JSON.stringify(data));
      }
      return ok({ ok: true, count: items.length });
    }

    return err("未知操作: " + action, 400);

  } catch (e) {
    console.error("feishu error:", e);
    return err(e.message);
  }
};