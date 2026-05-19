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
        platform VARCHAR(50) DEFAULT '',
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
      "ALTER TABLE kb_issues ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
      "ALTER TABLE kb_issues ADD COLUMN platform VARCHAR(50) DEFAULT ''"
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
    // ===== 客户群责人表 =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS group_owners (
        id VARCHAR(64) PRIMARY KEY,
        customer_id VARCHAR(200) NOT NULL,
        group_name VARCHAR(500) DEFAULT '',
        active_status VARCHAR(200) DEFAULT '',
        package_type VARCHAR(50) DEFAULT '',
        owner_a VARCHAR(50) NOT NULL,
        owner_b VARCHAR(50) NOT NULL,
        sales VARCHAR(100) DEFAULT '',
        note TEXT,
        sub_group TINYINT DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS group_sub_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sub_group TINYINT NOT NULL,
        owner_a VARCHAR(50) NOT NULL,
        owner_b VARCHAR(50) NOT NULL,
        last_assigned DATETIME DEFAULT NULL,
        UNIQUE KEY uk_sub_group (sub_group)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 插入初始4个子组（已存在则忽略）
    const initSubGroups = [
      [1, '臧东', '杨国桦'],
      [2, '杨国桦', '臧东'],
      [3, '李和枫', '黄科智'],
      [4, '黄科智', '李和枫']
    ];
    for (const [sg, a, b] of initSubGroups) {
      try {
        await conn.execute(
          "INSERT IGNORE INTO group_sub_config (sub_group, owner_a, owner_b) VALUES (?,?,?)",
          [sg, a, b]
        );
      } catch(e) { /* 忽略 */ }
    }
    // ===== 创新项目 Bug 表 =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS innovation_bugs (
        id VARCHAR(64) PRIMARY KEY,
        product VARCHAR(50) NOT NULL COMMENT '所属产品',
        module VARCHAR(100) DEFAULT '' COMMENT '所属模块',
        title VARCHAR(500) NOT NULL COMMENT 'Bug标题',
        description TEXT COMMENT 'Bug描述',
        attachments JSON COMMENT '附件列表',
        severity VARCHAR(10) DEFAULT '3级' COMMENT '严重程度',
        status VARCHAR(20) DEFAULT '待处理' COMMENT '状态',
        reporter VARCHAR(100) DEFAULT '' COMMENT '提报人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_product (product),
        INDEX idx_severity (severity),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 用户权限表 =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS sys_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(200) NOT NULL COMMENT 'bcrypt hash',
        display_name VARCHAR(100) DEFAULT '' COMMENT '显示名称',
        role VARCHAR(20) DEFAULT 'user' COMMENT 'admin/user',
        permissions JSON COMMENT '权限配置 {"tabs":{"list":"rw","bugs":"r"},...}',
        status VARCHAR(10) DEFAULT 'active' COMMENT 'active/disabled',
        last_login DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 初始化超级管理员（已存在则忽略）
    const [adminExists] = await conn.execute("SELECT id FROM sys_users WHERE username='admin'");
    if (!adminExists.length) {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync('admin123', 10);
      await conn.execute(
        "INSERT INTO sys_users (username, password, display_name, role, permissions) VALUES (?,?,?,?,?)",
        ['admin', hash, '超级管理员', 'admin', JSON.stringify({tabs:{list:'rw',kanban:'rw',person:'rw',feedback:'rw',schedule:'rw',issues:'rw',groups:'rw',bugs:'rw',users:'rw'}})]
      );
    }
  } finally {
    conn.release();
  }
}

module.exports = { getPool, initTables };
