const APP_ID = "cli_a9255b106cf81bc8";
const APP_SECRET = process.env.FEISHU_SECRET || "fYyAEs7wOH3UsU8SJgmemdIwtV6Iv5dw";
const APP_TOKEN_ISS = "LdVobWw4BaVcsms2ZHdcL2Ccnyg";
const BASE = "https://open.feishu.cn/open-apis";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

async function getToken() {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const d = await r.json();
  if (!d.tenant_access_token) throw new Error("获取 token 失败");
  return d.tenant_access_token;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method Not Allowed" }) };

  try {
    const contentType = event.headers["content-type"] || "";
    let buf, filename, mimetype;

    if (contentType.includes("application/json")) {
      const body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
      if (!body.base64 || !body.filename) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "缺少文件数据" }) };
      buf = Buffer.from(body.base64, "base64");
      filename = body.filename;
      mimetype = body.mimetype || "application/octet-stream";
    } else {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "不支持的 Content-Type" }) };
    }

    const token = await getToken();
    const boundary = "----FormBoundary" + Date.now();

    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n${filename}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="parent_type"\r\n\r\nbitable_file`,
      `--${boundary}\r\nContent-Disposition: form-data; name="parent_node"\r\n\r\n${APP_TOKEN_ISS}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${buf.length}`,
    ].join("\r\n") + `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`;

    const combined = Buffer.concat([Buffer.from(parts), buf, Buffer.from(`\r\n--${boundary}--`)]);
    const uploadRes = await fetch(`${BASE}/drive/v1/medias/upload_all`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: combined
    });
    const uploadData = await uploadRes.json();
    if (uploadData.code !== 0) throw new Error("上传失败: " + JSON.stringify(uploadData));
    return { statusCode: 200, headers: cors, body: JSON.stringify({ file_token: uploadData.data.file_token, name: filename, type: mimetype }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
