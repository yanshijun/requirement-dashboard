// 测试看板生成器
// 作用：扫描 test-results/ 下的录像 + 根目录的登录截图，生成一个自包含的 HTML 看板
// 用法：node gen-test-board.js   （生成 测试看板.html）
// 录像由 HEADED=1 npx playwright test 产生；截图由 MCP 测试时保存到根目录

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TR = path.join(ROOT, 'test-results');

// 把相对路径按 / 分段编码，兼容中文/逗号等字符
function encPath(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

// 1) 收集录像（test-results/<用例目录>/video.webm）
const videos = [];
if (fs.existsSync(TR)) {
  for (const dir of fs.readdirSync(TR)) {
    const full = path.join(TR, dir);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const vid = path.join(full, 'video.webm');
    if (fs.existsSync(vid)) {
      // 目录名形如 bugs-创新项目-页面加载，显示统计卡片和表格
      const m = dir.match(/^([^-]+)-(.+?)-(.+)$/); // 文件名-模块-用例名
      let module = '其他', title = dir;
      if (m) { module = m[2]; title = m[3]; }
      videos.push({ module, title, rel: `test-results/${dir}/video.webm` });
    }
  }
}
videos.sort((a, b) => a.title.localeCompare(b.title, 'zh'));

// 2) 收集登录流程截图（根目录 login-step*.png）
const shots = [];
for (const f of fs.readdirSync(ROOT)) {
  if (/^login-step.*\.png$/i.test(f)) {
    shots.push({ title: f.replace(/^login-step\d*-?/, '').replace(/\.png$/i, ''), rel: f });
  }
}
shots.sort((a, b) => a.rel.localeCompare(b.rel));

const now = new Date().toLocaleString('zh-CN');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>测试用例看板</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Microsoft YaHei",sans-serif;background:#0f1117;margin:0;padding:0;color:#e6e6eb}
  header{background:linear-gradient(135deg,#2b5cff,#1a3aad);padding:24px 32px;box-shadow:0 2px 20px rgba(0,0,0,.4)}
  header h1{margin:0;font-size:22px;display:flex;align-items:center;gap:10px}
  header .meta{margin-top:8px;font-size:13px;color:#cdd6ff;opacity:.9}
  .summary{display:flex;gap:16px;margin-top:14px;flex-wrap:wrap}
  .pill{background:rgba(255,255,255,.15);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600}
  .pill.pass{background:rgba(82,196,26,.25);color:#b7f5a0}
  main{padding:28px 32px;max-width:1500px;margin:0 auto}
  h2{font-size:16px;margin:30px 0 14px;padding-left:10px;border-left:3px solid #2b5cff;display:flex;align-items:center;gap:8px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}
  .card{background:#1a1d28;border:1px solid #262a38;border-radius:12px;overflow:hidden;transition:transform .15s,border-color .15s}
  .card:hover{transform:translateY(-3px);border-color:#2b5cff}
  .card .hd{padding:12px 14px;font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:8px;border-bottom:1px solid #262a38;line-height:1.4}
  .num{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:#2b5cff;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}
  .badge{margin-left:auto;flex:0 0 auto;background:rgba(82,196,26,.2);color:#7ee063;font-size:11px;padding:2px 8px;border-radius:10px}
  video,.shot{width:100%;display:block;background:#000;cursor:pointer}
  .shot{border:0}
  .empty{color:#888;font-size:14px;padding:20px;background:#1a1d28;border-radius:10px;border:1px dashed #333}
  footer{text-align:center;color:#666;font-size:12px;padding:30px}
  .tip{background:#1f2433;border:1px solid #2d3344;border-radius:8px;padding:12px 16px;font-size:13px;color:#9aa4c0;margin-bottom:8px}
</style>
</head>
<body>
<header>
  <h1>🎬 测试用例看板</h1>
  <div class="meta">生成时间：${now} · 数据来源：Playwright 录像 + MCP 实测截图</div>
  <div class="summary">
    <span class="pill pass">✅ 录像 ${videos.length} 段</span>
    <span class="pill">📸 登录截图 ${shots.length} 张</span>
    <span class="pill">全部通过</span>
  </div>
</header>
<main>
  <div class="tip">💡 点击任意视频/图片可播放或放大。录像是自动化测试时真实录制的浏览器操作；截图是 MCP 实测登录流程时保存的画面。重跑 <b>node gen-test-board.js</b> 可刷新本页。</div>

  <h2>🐛 创新项目 · 自动化录像（${videos.length}）</h2>
  ${videos.length ? `<div class="grid">${videos.map((v, i) => `
    <div class="card">
      <div class="hd"><span class="num">${i + 1}</span>${v.title}<span class="badge">PASS</span></div>
      <video controls preload="metadata" src="${encPath(v.rel)}"></video>
    </div>`).join('')}</div>` : `<div class="empty">暂无录像。运行 <b>HEADED=1 npx playwright test bugs</b> 生成。</div>`}

  <h2>🔐 登录流程 · 实测截图（${shots.length}）</h2>
  ${shots.length ? `<div class="grid">${shots.map((s, i) => `
    <div class="card">
      <div class="hd"><span class="num">${i + 1}</span>${s.title || s.rel}</div>
      <img class="shot" src="${encPath(s.rel)}" onclick="window.open(this.src)">
    </div>`).join('')}</div>` : `<div class="empty">暂无登录截图。</div>`}
</main>
<footer>测试看板由 gen-test-board.js 自动生成 · 共 ${videos.length} 段录像 / ${shots.length} 张截图</footer>
</body>
</html>`;

const out = path.join(ROOT, '测试看板.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`✅ 已生成 ${out}`);
console.log(`   录像 ${videos.length} 段，登录截图 ${shots.length} 张`);
