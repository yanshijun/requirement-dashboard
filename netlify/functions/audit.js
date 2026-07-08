// 操作留痕写入辅助：批量写 audit_log，失败只告警绝不阻塞主写操作。
const { getPool } = require('./db');

// entries: [{reqId, entityType, action, field, oldValue, newValue, operator, source, remark}]
async function logAudit(entries) {
  const rows = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  if (!rows.length) return;
  try {
    const pool = getPool();
    const values = rows.map(e => [
      String(e.reqId || ''),
      String(e.entityType || 'req'),
      String(e.action || 'update'),
      String(e.field || '').slice(0, 60),
      String(e.oldValue == null ? '' : e.oldValue).slice(0, 1000),
      String(e.newValue == null ? '' : e.newValue).slice(0, 1000),
      String(e.operator || '').slice(0, 100),
      String(e.source || 'manual').slice(0, 20),
      String(e.remark || '').slice(0, 500)
    ]);
    await pool.query(
      'INSERT INTO audit_log (req_id,entity_type,action,field,old_value,new_value,operator,source,remark) VALUES ?',
      [values]
    );
  } catch (e) {
    console.warn('[audit] 写留痕失败(不影响主流程):', e.message);
  }
}

module.exports = { logAudit };
