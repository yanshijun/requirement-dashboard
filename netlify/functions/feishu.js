const APP_ID = "cli_a9255b106cf81bc8";
const APP_SECRET = process.env.FEISHU_SECRET || "fYyAEs7wOH3UsU8SJgmemdIwtV6Iv5dw";
const APP_TOKEN = "XCgIb7NnwaAQq3sf1mjcQtdyned";
const TABLE_ID = "tblgnpLLYI2JGQH0";
const APP_TOKEN_FB = "YkThbXE9Gaa5O1s3FXDcjBX7nIb";
const TABLE_ID_FB = "tblO09dkYu2lRSE1";
const APP_TOKEN_SCH = "HUblb37mDah9Yfsb8VncqyYFnsd";
const TABLE_ID_SCH = "tbl3mddd8HhEWnMK";
const APP_TOKEN_ISS = "LdVobWw4BaVcsms2ZHdcL2Ccnyg";
const TABLE_ID_ISS = "tblsSPrURo45Yr2h";
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

// 获取飞书 token（内存缓存，有效期 1.5 小时）
let _tokenCache = null, _tokenExpiry = 0;
async function getToken(forceRefresh = false) {
  if (!forceRefresh && _tokenCache && Date.now() < _tokenExpiry) return _tokenCache;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error("获取飞书Token失败: " + JSON.stringify(data));
  _tokenCache = data.tenant_access_token;
  _tokenExpiry = Date.now() + 90 * 60 * 1000; // 1.5小时
  return _tokenCache;
}

// 读取飞书所有记录
async function getAllRecords(token, appToken, tableId, retry = true) {
  let records = [], pageToken = "";
  do {
    const url = `${BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500${pageToken ? "&page_token=" + pageToken : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    if (data.code === 99991663 && retry) {
      // Token 失效，刷新后重试
      const newToken = await getToken(true);
      return getAllRecords(newToken, appToken, tableId, false);
    }
    if (data.code !== 0) throw new Error("读取飞书记录失败: " + JSON.stringify(data));
    records = records.concat(data.data.items || []);
    pageToken = data.data.has_more ? data.data.page_token : "";
  } while (pageToken);
  return records;
}

// 飞书单选字段取值
function getSingleSelect(val) {
  if (!val) return "";
  if (typeof val === "object" && val.text) return String(val.text);
  return String(val);
}

// 飞书多选字段取值
function getMultiSelect(val) {
  if (!val) return "";
  if (Array.isArray(val)) {
    return val.map(v => (typeof v === "object" && v.text ? v.text : String(v))).join(",");
  }
  if (typeof val === "object" && val.text) return String(val.text);
  return String(val);
}

// 将值转为飞书多选数组格式
function toMultiSelect(val) {
  if (!val) return [];
  const str = String(val).trim();
  if (!str) return [];
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

// ===== 需求表 映射 =====
function mapFromFeishu(record) {
  const f = record.fields || {};
  let progress = 0;
  if (f["开发进度"] !== undefined && f["开发进度"] !== null) {
    const raw = parseFloat(f["开发进度"]);
    progress = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
  }
  return {
    id: record.record_id,
    no: String(f["需求编号"] || ""),
    name: String(f["需求名称"] || ""),
    desc: String(f["需求描述"] || ""),
    type: String(f["需求类型"] || "用户需求"),
    plan: getMultiSelect(f["所属计划"]),
    priority: getSingleSelect(f["优先级"]),
    status: getSingleSelect(f["开发状态"]),
    progress,
    person: getMultiSelect(f["需求认领人"]),
    deadline: fromFeishuDate(f["预计上线日期"]),
    design: getSingleSelect(f["是否需要设计"]),
    review: getSingleSelect(f["评审是否通过"]),
    createTime: fromFeishuDate(f["提出时间"]),
    submitter: String(f["提出人"] || ""),
    note: String(f["备注"] || ""),
    parentId: String(f["父需求ID"] || "")
  };
}

function mapToFeishu(item) {
  const fields = {
    "需求编号": String(item.no || ""),
    "需求名称": String(item.name || ""),
    "需求描述": String(item.desc || ""),
    "需求类型": String(item.type || ""),
    "所属计划": toMultiSelect(item.plan),
    "优先级": String(item.priority || ""),
    "开发状态": String(item.status || "待开始"),
    "开发进度": Math.round(parseInt(item.progress || 0)) / 100,
    "需求认领人": toMultiSelect(item.person),
    "是否需要设计": String(item.design || ""),
    "评审是否通过": String(item.review || ""),
    "提出人": String(item.submitter || ""),
    "备注": String(item.note || ""),
    "父需求ID": String(item.parentId || "")
  };
  const deadline = toFeishuDate(item.deadline);
  if (deadline) fields["预计上线日期"] = deadline;
  const createTime = toFeishuDate(item.createTime);
  if (createTime) fields["提出时间"] = createTime;
  return fields;
}

// ===== 今日收集表 映射 =====
function mapFromFeedback(record) {
  const f = record.fields || {};
  return {
    id: record.record_id,
    title: String(f["标题"] || ""),
    source: getSingleSelect(f["来源"]) || "其他",
    priority: getSingleSelect(f["优先级"]) || "中🟡",
    reporter: String(f["反馈人"] || ""),
    customerId: String(f["反馈客户ID"] || ""),
    desc: String(f["描述"] || ""),
    note: String(f["跟进备注"] || ""),
    status: getSingleSelect(f["状态"]) || "待跟进",
    createTime: fromFeishuDate(f["提出时间"]),
    reqId: String(f["关联需求id"] || "")
  };
}

function mapToFeedback(item) {
  const fields = {
    "标题": String(item.title || ""),
    "来源": String(item.source || "其他"),
    "优先级": String(item.priority || "中🟡"),
    "反馈人": String(item.reporter || ""),
    "反馈客户ID": String(item.customerId || ""),
    "描述": String(item.desc || ""),
    "跟进备注": String(item.note || ""),
    "状态": String(item.status || "待跟进")
  };
  const createTime = toFeishuDate(item.createTime);
  if (createTime) fields["提出时间"] = createTime;
  if (item.reqId) fields["关联需求id"] = String(item.reqId);
  return fields;
}

// ===== 排班表 映射 =====
function mapFromSchedule(record) {
  const f = record.fields || {};
  return {
    id: record.record_id,
    date: String(f["日期"] || ""),
    weekday: String(f["星期"] || ""),
    group: String(f["组别"] || ""),
    onDuty: String(f["值班人"] || ""),
    backup: String(f["备班人"] || "")
  };
}
function mapToSchedule(item) {
  return {
    "日期": String(item.date || ""),
    "星期": String(item.weekday || ""),
    "组别": String(item.group || ""),
    "值班人": String(item.onDuty || ""),
    "备班人": String(item.backup || "")
  };
}

// ===== 客户问题记录 映射 =====
function mapFromIssue(record) {
  const f = record.fields || {};
  return {
    id: record.record_id,
    date: String(f["日期"] || ""),
    customerId: String(f["客户id"] || ""),
    packageType: String(f["套餐类型"] || ""),
    desc: String(f["问题描述"] || ""),
    person: String(f["责任人"] || ""),
    status: String(f["处理状态"] || "未解决"),
    solution: String(f["解决方案"] || ""),
    tags: String(f["问题标签"] || ""),
    platform: String(f["平台"] || ""),
    inKb: f["是否入库"] !== false,
    attachments: Array.isArray(f["问题附件"]) ? f["问题附件"].map(a => ({
      file_token: a.file_token || "",
      name: a.name || "附件",
      type: a.type || ""
    })) : []
  };
}
function mapToIssue(item) {
  const fields = {
    "日期": String(item.date || ""),
    "客户id": String(item.customerId || ""),
    "套餐类型": String(item.packageType || ""),
    "问题描述": String(item.desc || ""),
    "责任人": String(item.person || ""),
    "处理状态": String(item.status || "未解决"),
    "解决方案": String(item.solution || ""),
    "问题标签": String(item.tags || ""),
    "平台": String(item.platform || ""),
    "是否入库": item.inKb !== false
  };
  if (Array.isArray(item.attachments) && item.attachments.length > 0) {
    fields["问题附件"] = item.attachments.map(a => ({ file_token: a.file_token }));
  }
  return fields;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;
  const table = event.queryStringParameters?.table;

  try {
    const token = await getToken();

    // ===== GET =====
    if (event.httpMethod === "GET") {
      if (table === "feedback") {
        const records = await getAllRecords(token, APP_TOKEN_FB, TABLE_ID_FB);
        return ok(records.map(mapFromFeedback));
      }
      if (table === "schedule") {
        const records = await getAllRecords(token, APP_TOKEN_SCH, TABLE_ID_SCH);
        return ok(records.map(mapFromSchedule));
      }
      if (table === "issues") {
        const records = await getAllRecords(token, APP_TOKEN_ISS, TABLE_ID_ISS);
        return ok(records.map(mapFromIssue));
      }
      if (table === "all") {
        const [req, fb] = await Promise.all([
          getAllRecords(token, APP_TOKEN, TABLE_ID),
          getAllRecords(token, APP_TOKEN_FB, TABLE_ID_FB)
        ]);
        return ok({ requirements: req.map(mapFromFeishu), feedback: fb.map(mapFromFeedback) });
      }
      const records = await getAllRecords(token, APP_TOKEN, TABLE_ID);
      return ok(records.map(mapFromFeishu));
    }

    if (event.httpMethod !== "POST") return err("Method Not Allowed", 405);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch (e) { return err("请求格式错误", 400); }

    // ===== 需求：新增 =====
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

    // ===== 需求：更新 =====
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

    // ===== 需求：删除 =====
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

    // ===== 需求：批量导入 =====
    if (action === "import") {
      const items = Array.isArray(body) ? body : [];
      if (!items.length) return err("数据为空", 400);
      const old = await getAllRecords(token, APP_TOKEN, TABLE_ID);
      for (let i = 0; i < old.length; i += 500) {
        const ids = old.slice(i, i + 500).map(r => r.record_id);
        await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_delete`, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ records: ids })
        });
      }
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

    // ===== 今日收集：新增 =====
    if (action === "fb-add") {
      if (!body.title) return err("标题不能为空", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_FB}/tables/${TABLE_ID_FB}/records`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToFeedback(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("新增反馈失败: " + JSON.stringify(data));
      return ok({ ok: true, item: mapFromFeedback(data.data.record) });
    }

    // ===== 今日收集：更新 =====
    if (action === "fb-update") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_FB}/tables/${TABLE_ID_FB}/records/${body.id}`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToFeedback(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("更新反馈失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 今日收集：删除 =====
    if (action === "fb-delete") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_FB}/tables/${TABLE_ID_FB}/records/${body.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token }
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("删除反馈失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 排班表：新增 =====
    if (action === "sch-add") {
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_SCH}/tables/${TABLE_ID_SCH}/records`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToSchedule(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("新增排班失败: " + JSON.stringify(data));
      return ok({ ok: true, item: mapFromSchedule(data.data.record) });
    }

    // ===== 排班表：批量新增 =====
    if (action === "sch-batch-add") {
      const items = Array.isArray(body) ? body : [];
      if (!items.length) return err("数据为空", 400);
      for (let i = 0; i < items.length; i += 500) {
        const batch = items.slice(i, i + 500).map(item => ({ fields: mapToSchedule(item) }));
        const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_SCH}/tables/${TABLE_ID_SCH}/records/batch_create`, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ records: batch })
        });
        const data = await res.json();
        if (data.code !== 0) throw new Error("批量新增排班失败: " + JSON.stringify(data));
      }
      return ok({ ok: true, count: items.length });
    }

    // ===== 排班表：更新 =====
    if (action === "sch-update") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_SCH}/tables/${TABLE_ID_SCH}/records/${body.id}`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToSchedule(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("更新排班失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 排班表：删除 =====
    if (action === "sch-delete") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_SCH}/tables/${TABLE_ID_SCH}/records/${body.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token }
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("删除排班失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 客户问题：新增 =====
    if (action === "iss-add") {
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_ISS}/tables/${TABLE_ID_ISS}/records`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToIssue(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("新增问题记录失败: " + JSON.stringify(data));
      return ok({ ok: true, item: mapFromIssue(data.data.record) });
    }

    // ===== 客户问题：更新 =====
    if (action === "iss-update") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_ISS}/tables/${TABLE_ID_ISS}/records/${body.id}`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: mapToIssue(body) })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("更新问题记录失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 客户问题：删除 =====
    if (action === "iss-delete") {
      if (!body.id) return err("缺少记录ID", 400);
      const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN_ISS}/tables/${TABLE_ID_ISS}/records/${body.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token }
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error("删除问题记录失败: " + JSON.stringify(data));
      return ok({ ok: true });
    }

    // ===== 附件：上传文件到飞书（base64 multipart） =====
    if (action === "iss-upload") {
      const { filename, mimetype, base64 } = body;
      if (!base64 || !filename) return err("缺少文件数据", 400);
      const buf = Buffer.from(base64, "base64");
      const boundary = "----FormBoundary" + Date.now();
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype || "application/octet-stream"}\r\n\r\n`,
      ];
      const header = Buffer.from(parts[0]);
      const footer = Buffer.from(`\r\n--${boundary}--`);
      const combined = Buffer.concat([header, buf, footer]);
      const uploadRes = await fetch(`${BASE}/drive/v1/medias/upload_all`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": `multipart/form-data; boundary=${boundary}`
        },
        body: combined
      });
      const uploadData = await uploadRes.json();
      if (uploadData.code !== 0) throw new Error("上传失败: " + JSON.stringify(uploadData));
      return ok({ file_token: uploadData.data.file_token, name: filename, type: mimetype || "" });
    }

    // ===== 附件：获取预览/下载 URL =====
    if (action === "iss-file-url") {
      const { file_token } = body;
      if (!file_token) return err("缺少 file_token", 400);
      const urlRes = await fetch(`${BASE}/drive/v1/medias/${file_token}/download`, {
        method: "GET",
        headers: { Authorization: "Bearer " + token }
      });
      const buf = await urlRes.arrayBuffer();
      const contentType = urlRes.headers.get("content-type") || "application/octet-stream";
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": contentType },
        body: Buffer.from(buf).toString("base64"),
        isBase64Encoded: true
      };
    }

    return err("未知操作: " + action, 400);

  } catch (e) {
    console.error("feishu error:", e);
    return err(e.message);
  }
};
