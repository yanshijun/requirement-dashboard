const mysql = require('mysql2/promise');

let pool = null;

// 远程公网 MySQL 会关闭空闲连接，连接池可能把这条"已被服务器关掉的死连接"发出来用，
// 表现为 "Connection lost: The server closed the connection"。对这类错误自动重试一次（池会换新连接）。
function _isConnLost(e) {
  const s = ((e && (e.code || e.message)) || '') + '';
  return /PROTOCOL_CONNECTION_LOST|ECONNRESET|EPIPE|ETIMEDOUT|closed the connection|Can't add new command when connection is in closed state/i.test(s);
}
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
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    idleTimeout: 30000,        // 空闲 30s 回收，抢在远程服务器关闭之前
    charset: 'utf8mb4'
  });
  // 在池层包装 execute/query：遇到"连接被关闭"类错误自动重试一次，所有调用方无感获益
  const rawExecute = pool.execute.bind(pool);
  const rawQuery = pool.query.bind(pool);
  pool.execute = async (...a) => { try { return await rawExecute(...a); } catch (e) { if (_isConnLost(e)) return await rawExecute(...a); throw e; } };
  pool.query = async (...a) => { try { return await rawQuery(...a); } catch (e) { if (_isConnLost(e)) return await rawQuery(...a); throw e; } };
  return pool;
}

async function _initTablesOnce() {
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
        chat_up LONGTEXT COMMENT 'CHAT-UP（长JSON）',
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
      "ALTER TABLE kb_issues ADD COLUMN platform VARCHAR(50) DEFAULT ''",
      "ALTER TABLE kb_issues ADD COLUMN chat_up LONGTEXT"
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
        seq_no INT AUTO_INCREMENT UNIQUE COMMENT '自增编号',
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
    await conn.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='innovation_bugs' AND COLUMN_NAME='seq_no'
    `).then(async ([rows]) => {
      if (!rows.length) {
        await conn.execute("ALTER TABLE innovation_bugs ADD COLUMN seq_no INT AUTO_INCREMENT UNIQUE AFTER id");
      }
    });
    // ===== 需求 Bug 清单表（与创新项目同构，数据独立） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS requirement_bugs (
        id VARCHAR(64) PRIMARY KEY,
        seq_no INT AUTO_INCREMENT UNIQUE COMMENT '自增编号',
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
    await conn.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='requirement_bugs' AND COLUMN_NAME='seq_no'
    `).then(async ([rows]) => {
      if (!rows.length) {
        await conn.execute("ALTER TABLE requirement_bugs ADD COLUMN seq_no INT AUTO_INCREMENT UNIQUE AFTER id");
      }
    });
    // ===== 计划列表（服务端持久化，替代浏览器 localStorage） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS req_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE COMMENT '计划名称',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    // ===== 需求生命周期（挂在飞书需求ID上，四阶段完成情况） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS req_lifecycle (
        req_id VARCHAR(64) PRIMARY KEY COMMENT '需求ID(飞书记录ID)',
        current_stage VARCHAR(20) DEFAULT '销售提报' COMMENT '当前阶段',
        stages JSON COMMENT '各阶段 {阶段:{status,owner,progress}}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 需求 流转日志（留痕） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS collab_flow_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        req_id VARCHAR(64) NOT NULL COMMENT '需求ID',
        from_stage VARCHAR(20) DEFAULT '' COMMENT '原阶段',
        to_stage VARCHAR(20) NOT NULL COMMENT '新阶段',
        operator VARCHAR(100) DEFAULT '' COMMENT '操作人',
        remark VARCHAR(500) DEFAULT '' COMMENT '备注',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_req (req_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 卡点问题（挂在需求上） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS collab_blockers (
        id VARCHAR(64) PRIMARY KEY,
        seq_no INT AUTO_INCREMENT UNIQUE COMMENT '自增编号',
        req_id VARCHAR(64) DEFAULT '' COMMENT '关联需求ID(可空)',
        dept VARCHAR(50) NOT NULL COMMENT '归属部门',
        stage VARCHAR(20) DEFAULT '' COMMENT '所属流程阶段',
        description VARCHAR(1000) NOT NULL COMMENT '卡点描述',
        impact VARCHAR(500) DEFAULT '' COMMENT '影响范围',
        occurred_at DATE NULL COMMENT '问题产生时间',
        resources_needed VARCHAR(500) DEFAULT '' COMMENT '待协调资源',
        expected_resolve_at DATE NULL COMMENT '预期解决节点',
        follower VARCHAR(100) DEFAULT '' COMMENT '跟进人',
        progress_note TEXT COMMENT '处置进展',
        status VARCHAR(20) DEFAULT '待处理' COMMENT '状态',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_dept (dept),
        INDEX idx_stage (stage),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 认领留痕（每次认领/换人/释放/移除都记录一条） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS collab_claim_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        req_id VARCHAR(64) NOT NULL COMMENT '需求ID(飞书记录ID)',
        action VARCHAR(20) NOT NULL DEFAULT '认领' COMMENT '认领/换人/释放/移除',
        persons VARCHAR(500) DEFAULT '' COMMENT '本次动作后的认领人(逗号分隔)',
        operator VARCHAR(100) DEFAULT '' COMMENT '执行动作的登录账号显示名',
        remark VARCHAR(500) DEFAULT '' COMMENT '备注(如移除了谁)',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_req (req_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 需求主表（从飞书迁入；id 保留飞书 record_id 以续接生命周期/卡点/反馈关联） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS reqs (
        id VARCHAR(64) PRIMARY KEY COMMENT '需求ID(沿用飞书记录ID或 req_ 前缀新ID)',
        req_no VARCHAR(50) DEFAULT '' COMMENT '需求编号',
        name VARCHAR(500) NOT NULL DEFAULT '' COMMENT '需求名称',
        description TEXT COMMENT '需求描述',
        req_type VARCHAR(50) DEFAULT '用户需求' COMMENT '需求类型',
        plan VARCHAR(500) DEFAULT '' COMMENT '所属计划(多选,逗号分隔)',
        priority VARCHAR(20) DEFAULT '' COMMENT '优先级',
        status VARCHAR(20) DEFAULT '待开始' COMMENT '开发状态',
        progress INT DEFAULT 0 COMMENT '开发进度 0-100 整数',
        person VARCHAR(500) DEFAULT '' COMMENT '认领人(多选,逗号分隔)',
        deadline VARCHAR(20) DEFAULT '' COMMENT '预计上线日期 YYYY-MM-DD',
        design VARCHAR(20) DEFAULT '' COMMENT '是否需要设计',
        review VARCHAR(20) DEFAULT '' COMMENT '评审是否通过',
        create_time VARCHAR(20) DEFAULT '' COMMENT '提出时间 YYYY-MM-DD',
        submitter VARCHAR(300) DEFAULT '' COMMENT '提出人',
        note TEXT COMMENT '备注',
        parent_id VARCHAR(64) DEFAULT '' COMMENT '父需求ID(自引用)',
        attachments JSON COMMENT '附件 [{file_token,name,type}]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_parent (parent_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 今日收集/反馈表 =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS feedback (
        id VARCHAR(64) PRIMARY KEY COMMENT '反馈ID(沿用飞书记录ID或 fb_ 前缀新ID)',
        title VARCHAR(500) DEFAULT '' COMMENT '标题',
        source VARCHAR(50) DEFAULT '其他' COMMENT '来源',
        priority VARCHAR(20) DEFAULT '中🟡' COMMENT '优先级',
        reporter VARCHAR(200) DEFAULT '' COMMENT '反馈人',
        customer_id VARCHAR(200) DEFAULT '' COMMENT '反馈客户ID',
        description TEXT COMMENT '描述',
        note TEXT COMMENT '跟进备注',
        status VARCHAR(20) DEFAULT '待跟进' COMMENT '状态',
        create_time VARCHAR(20) DEFAULT '' COMMENT '提出时间 YYYY-MM-DD',
        req_id VARCHAR(64) DEFAULT '' COMMENT '关联需求ID',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_req (req_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 排班表 =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS schedule (
        id VARCHAR(64) PRIMARY KEY COMMENT '排班ID(沿用飞书记录ID或 sch_ 前缀新ID)',
        date_str VARCHAR(20) DEFAULT '' COMMENT '日期(文本)',
        weekday VARCHAR(20) DEFAULT '' COMMENT '星期',
        group_name VARCHAR(200) DEFAULT '' COMMENT '组别',
        on_duty VARCHAR(300) DEFAULT '' COMMENT '值班人',
        backup VARCHAR(300) DEFAULT '' COMMENT '备班人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (date_str)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 附件表（需求/问题/Bug 共用，base64 存 MySQL，token=原 file_token 语义） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS attachments (
        token VARCHAR(191) PRIMARY KEY COMMENT '附件token(新上传自生成/迁移沿用飞书file_token)',
        filename VARCHAR(500) DEFAULT '' COMMENT '文件名',
        mimetype VARCHAR(150) DEFAULT '' COMMENT 'MIME类型',
        data LONGTEXT COMMENT '文件内容(base64)',
        size INT DEFAULT 0 COMMENT '字节大小',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ===== 操作留痕（审计日志：需求/生命周期阶段/卡点 的谁-何时-把什么从A改成B） =====
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        req_id VARCHAR(64) DEFAULT '' COMMENT '关联需求ID(留痕挂到需求上，供详情聚合)',
        entity_type VARCHAR(20) DEFAULT 'req' COMMENT 'req/stage/blocker',
        action VARCHAR(30) NOT NULL COMMENT 'create/update/delete/import/stage-edit/blocker-*',
        field VARCHAR(60) DEFAULT '' COMMENT '变更字段中文名(update/stage-edit类)',
        old_value VARCHAR(1000) DEFAULT '' COMMENT '旧值',
        new_value VARCHAR(1000) DEFAULT '' COMMENT '新值',
        operator VARCHAR(100) DEFAULT '' COMMENT '操作人(前端登录显示名)',
        source VARCHAR(20) DEFAULT 'manual' COMMENT 'manual/auto-align/backfill/system',
        remark VARCHAR(500) DEFAULT '' COMMENT '备注',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_req (req_id),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } finally {
    conn.release();
  }
}

let _initPromise = null;
// 只在进程生命周期内初始化一次：避免每个 API 请求都重跑 ~16 张 CREATE TABLE。
// 远程公网 MySQL 高延迟时，每请求重建会累积成多秒卡顿（表现为"生命周期一直在加载"）。
// 表用 IF NOT EXISTS，跑一次即可；失败则清空缓存以便下次重试。
function initTables() {
  if (!_initPromise) _initPromise = _initTablesOnce().catch(e => { _initPromise = null; throw e; });
  return _initPromise;
}

module.exports = { getPool, initTables };
