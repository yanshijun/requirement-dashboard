const express = require('express');
const path = require('path');
const { handler } = require('./netlify/functions/feishu');
const { handler: uploadHandler } = require('./netlify/functions/upload');
const { handler: kbHandler } = require('./netlify/functions/kb');
const { handler: groupsHandler } = require('./netlify/functions/groups');
const { handler: bugsHandler } = require('./netlify/functions/bugs');
const { handler: authHandler } = require('./netlify/functions/auth');
const { handler: usersHandler } = require('./netlify/functions/users');

const app = express();
const PORT = process.env.PORT || 3000;

// 环境变量说明（本地开发可在 .env 或直接设置）：
// DB_HOST=8.135.12.29        本地/线上均用公网 IP
// DB_PORT=13306
// DB_USER=root
// DB_PASS=yqwl88888888..
// DB_NAME=As_LogData
// QWEN_API_KEY=sk-xxx
// FEISHU_SECRET=xxx

app.use(express.json({ limit: '10mb' }));

// 将 Express req/res 适配成 Netlify Function 的调用格式
app.post('/api/upload', async (req, res) => {
  const event = {
    httpMethod: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    isBase64Encoded: false
  };
  try {
    const result = await uploadHandler(event);
    res.status(result.statusCode).set(result.headers).send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.all('/api/kb', async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: req.method === 'POST' ? JSON.stringify(req.body) : null,
    headers: req.headers
  };
  try {
    const result = await kbHandler(event);
    res.status(result.statusCode).set(result.headers);
    if (result.isBase64Encoded) res.send(Buffer.from(result.body, 'base64'));
    else res.send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.all('/api/feishu', async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: req.method === 'POST' ? JSON.stringify(req.body) : null,
    headers: req.headers
  };
  try {
    const result = await handler(event);
    res.status(result.statusCode).set(result.headers);
    if (result.isBase64Encoded) res.send(Buffer.from(result.body, 'base64'));
    else res.send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.all('/api/groups', async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: req.method === 'POST' ? JSON.stringify(req.body) : null,
    headers: req.headers
  };
  try {
    const result = await groupsHandler(event);
    res.status(result.statusCode).set(result.headers);
    if (result.isBase64Encoded) res.send(Buffer.from(result.body, 'base64'));
    else res.send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.all('/api/bugs', async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: req.method === 'POST' ? JSON.stringify(req.body) : null,
    headers: req.headers
  };
  try {
    const result = await bugsHandler(event);
    res.status(result.statusCode).set(result.headers);
    if (result.isBase64Encoded) res.send(Buffer.from(result.body, 'base64'));
    else res.send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.all('/api/auth', async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: req.method === 'POST' ? JSON.stringify(req.body) : null,
    headers: req.headers
  };
  try {
    const result = await authHandler(event);
    res.status(result.statusCode).set(result.headers).send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.all('/api/users', async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: req.method === 'POST' ? JSON.stringify(req.body) : null,
    headers: req.headers
  };
  try {
    const result = await usersHandler(event);
    res.status(result.statusCode).set(result.headers).send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 服务静态文件
app.use(express.static(path.join(__dirname)));

// 所有其他路由返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ 服务已启动: http://localhost:${PORT}`);
});
