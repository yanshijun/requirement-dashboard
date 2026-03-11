const { getStore } = require("@netlify/blobs");

const STORE = "requirements";
const KEY = "all";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

async function getData(store) {
  const raw = await store.get(KEY);
  return raw ? JSON.parse(raw) : [];
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const store = getStore(STORE);
  const action = event.queryStringParameters?.action;

  try {
    // 读取全部
    if (event.httpMethod === "GET") {
      const data = await getData(store);
      return { statusCode: 200, headers: cors, body: JSON.stringify(data) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      let data = await getData(store);

      // 新增
      if (action === "add") {
        const item = {
          ...body,
          id: Date.now().toString(),
          createTime: new Date().toLocaleDateString("zh-CN")
        };
        data.unshift(item);
        await store.set(KEY, JSON.stringify(data));
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, item }) };
      }

      // 更新
      if (action === "update") {
        const idx = data.findIndex(d => d.id === body.id);
        if (idx === -1) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "未找到该需求" }) };
        data[idx] = { ...data[idx], ...body };
        await store.set(KEY, JSON.stringify(data));
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }

      // 删除
      if (action === "delete") {
        data = data.filter(d => d.id !== body.id);
        await store.set(KEY, JSON.stringify(data));
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }

      // 批量导入（从飞书或Excel迁移数据用）
      if (action === "import") {
        const items = Array.isArray(body) ? body : [];
        const imported = items.map((item, i) => ({
          ...item,
          id: item.id || (Date.now() + i).toString(),
          createTime: item.createTime || new Date().toLocaleDateString("zh-CN")
        }));
        await store.set(KEY, JSON.stringify(imported));
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, count: imported.length }) };
      }
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "未知操作" }) };
  } catch (e) {
    console.error("api error:", e);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
