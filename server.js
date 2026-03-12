const express = require('express');
const path = require('path');
const { handler } = require('./netlify/functions/feishu');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 将 Express req/res 适配成 Netlify Function 的调用格式
app.all('/api/feishu', async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: req.method === 'POST' ? JSON.stringify(req.body) : null,
    headers: req.headers
  };
  try {
    const result = await handler(event);
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
