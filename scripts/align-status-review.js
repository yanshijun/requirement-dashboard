// 一次性：把现有需求的「开发状态」和「评审」对齐到生命周期阶段（幂等，可重跑）。
// 映射：提报/研发评审→待开始(专题探讨保留)，开发认领→开发中，测试认领→测试中；不覆盖 联调中/待上线/已上线/已暂缓。
// 评审：生命周期「研发评审」阶段已完成(或当前阶段已越过评审) → 评审=已通过。
const mysql = require('mysql2/promise');
const LC = ['提报', '研发评审', '开发认领', '测试认领'];
const KEEP = ['联调中', '待上线', '已上线', '已暂缓'];
const idxDev = LC.indexOf('开发认领'), idxTest = LC.indexOf('测试认领'), idxReview = LC.indexOf('研发评审');

function alignedStatus(stage, cur) {
  if (KEEP.includes(cur)) return cur;
  const i = LC.indexOf(stage || '提报');
  if (i >= idxTest) return '测试中';
  if (i === idxDev) return '开发中';
  return cur === '专题探讨' ? '专题探讨' : '待开始';
}
function reviewDone(stage, stagesJson) {
  if (LC.indexOf(stage || '提报') > idxReview) return true;
  try { const s = typeof stagesJson === 'string' ? JSON.parse(stagesJson) : stagesJson; return !!(s && s['研发评审'] && s['研发评审'].status === '已完成'); }
  catch (e) { return false; }
}
async function withRetry(fn, n = 5) {
  let e;
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (err) { e = err; if (err.code !== 'ETIMEDOUT' && err.code !== 'PROTOCOL_CONNECTION_LOST' && err.code !== 'ECONNRESET') throw err; await new Promise(r => setTimeout(r, 2000)); }
  }
  throw e;
}

(async () => {
  const pool = mysql.createPool({ host: '8.135.12.29', port: 13306, user: 'root', password: 'yqwl88888888..', database: 'As_LogData', connectTimeout: 20000, waitForConnections: true, connectionLimit: 3, charset: 'utf8mb4' });
  const [reqs] = await withRetry(() => pool.query('SELECT id,req_no,status,review FROM reqs'));
  const [lifes] = await withRetry(() => pool.query('SELECT req_id,current_stage,stages FROM req_lifecycle'));
  const lm = {}; lifes.forEach(l => lm[l.req_id] = { stage: l.current_stage || '提报', stages: l.stages });
  let sc = 0, rc = 0; const dg = [];
  for (const r of reqs) {
    const life = lm[r.id] || { stage: '提报', stages: null };
    const ns = alignedStatus(life.stage, r.status || '');
    const nr = reviewDone(life.stage, life.stages) ? '已通过' : (r.review || '');
    const sChg = ns !== (r.status || ''), rChg = nr !== (r.review || '');
    if (!sChg && !rChg) continue;
    if (sChg && r.status === '测试中' && ns === '开发中') dg.push(r.req_no);
    await withRetry(() => pool.execute('UPDATE reqs SET status=?, review=? WHERE id=?', [ns, nr, r.id]));
    if (sChg) sc++; if (rChg) rc++;
  }
  console.log('✅ 开发状态对齐 ' + sc + ' 条；评审对齐 ' + rc + ' 条');
  console.log('⚠ 降级(测试中→开发中，阶段落后)编号: ' + (dg.join(', ') || '无'));
  const [[s]] = await withRetry(() => pool.query("SELECT SUM(status='开发中')dev,SUM(status='测试中')test,SUM(status='待开始')todo,SUM(review='已通过')passed FROM reqs"));
  console.log('对齐后统计: 开发中=' + s.dev + ' 测试中=' + s.test + ' 待开始=' + s.todo + ' 评审已通过=' + s.passed);
  await pool.end();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
