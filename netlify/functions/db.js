const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.DB_HOST || '8.135.12.29',
    port: parseInt(process.env.DB_PORT || '13306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'yqwl88888888..',
    database: process.env.DB_NAME || 'As_LogData',
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10000,
    charset: 'utf8mb4'
  });
  return pool;
}

async function initTables() {
  const conn = await getPool().getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS kb_issues (
        id VARCHAR(64) PRIMARY KEY,
        date_str VARCHAR(20),
        customer_id VARCHAR(200),
        package_type VARCHAR(50),
        desc_text TEXT,
        solution TEXT,
        tags VARCHAR(500),
        status VARCHAR(20) DEFAULT '未解决',
        person VARCHAR(100),
        in_kb TINYINT(1) DEFAULT 1,
        attachments JSON COMMENT '附件列表',
        embedding LONGTEXT COMMENT '向量JSON数组',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 兼容旧表：尝试加字段，已存在则忽略
    const toAdd = [
      "ALTER TABLE kb_issues ADD COLUMN customer_id VARCHAR(200)",
      "ALTER TABLE kb_issues ADD COLUMN person VARCHAR(100)",
      "ALTER TABLE kb_issues ADD COLUMN attachments JSON",
      "ALTER TABLE kb_issues ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
    ];
    for (const sql of toAdd) {
      try { await conn.execute(sql); } catch(e) { /* 字段已存在，忽略 */ }
    }
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS kb_chats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        query_text TEXT,
        answer_text MEDIUMTEXT,
        used_cases INT DEFAULT 0,
        user_name VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_session (session_id),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } finally {
    conn.release();
  }
}

module.exports = { getPool, initTables };
