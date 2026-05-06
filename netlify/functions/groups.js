const { getPool, initTables } = require('./db');

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }

function genId() {
  return "grp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const action = event.queryStringParameters?.action;

  try {
    await initTables();
    const pool = getPool();

    // ===== 获取群列表 =====
    if (event.httpMethod === "GET" || action === "list") {
      const q = event.queryStringParameters?.q || "";
      let sql = "SELECT * FROM group_owners";
      const params = [];
      if (q) {
        sql += " WHERE customer_id LIKE ? OR group_name LIKE ? OR owner_a LIKE ? OR owner_b LIKE ? OR sales LIKE ?";
        const like = `%${q}%`;
        params.push(like, like, like, like, like);
      }
      sql += " ORDER BY created_at DESC";
      const [rows] = await pool.execute(sql, params);
      return ok(rows.map(r => ({
        id: r.id,
        customerId: r.customer_id,
        groupName: r.group_name,
        activeStatus: r.active_status,
        packageType: r.package_type,
        ownerA: r.owner_a,
        ownerB: r.owner_b,
        sales: r.sales,
        note: r.note,
        subGroup: r.sub_group,
        createdAt: r.created_at
      })));
    }

    const body = JSON.parse(event.body || "{}");

    // ===== 预览下一个轮到的子组（不分配） =====
    if (action === "next-owner") {
      const [rows] = await pool.execute(
        "SELECT * FROM group_sub_config ORDER BY last_assigned IS NOT NULL, last_assigned ASC, id ASC LIMIT 1"
      );
      if (!rows.length) return err("子组配置为空", 500);
      const next = rows[0];
      return ok({ subGroup: next.sub_group, ownerA: next.owner_a, ownerB: next.owner_b });
    }

    // ===== 获取子组配置 =====
    if (action === "config-list") {
      const [rows] = await pool.execute("SELECT * FROM group_sub_config ORDER BY sub_group ASC");
      return ok(rows.map(r => ({
        id: r.id,
        subGroup: r.sub_group,
        ownerA: r.owner_a,
        ownerB: r.owner_b,
        lastAssigned: r.last_assigned
      })));
    }

    // ===== 更新子组配置 =====
    if (action === "config-update") {
      const { configs } = body; // [{id, ownerA, ownerB}]
      if (!Array.isArray(configs) || !configs.length) return err("配置数据为空", 400);
      for (const c of configs) {
        if (!c.id || !c.ownerA || !c.ownerB) continue;
        await pool.execute(
          "UPDATE group_sub_config SET owner_a=?, owner_b=? WHERE id=?",
          [c.ownerA, c.ownerB, c.id]
        );
      }
      return ok({ ok: true });
    }

    // ===== 新增子组 =====
    if (action === "config-add") {
      const { ownerA, ownerB } = body;
      if (!ownerA || !ownerB) return err("责任人A和B不能为空", 400);
      const [[maxRow]] = await pool.execute("SELECT MAX(sub_group) as m FROM group_sub_config");
      const nextSg = (maxRow.m || 0) + 1;
      await pool.execute(
        "INSERT INTO group_sub_config (sub_group, owner_a, owner_b) VALUES (?,?,?)",
        [nextSg, ownerA, ownerB]
      );
      return ok({ ok: true, subGroup: nextSg });
    }

    // ===== 新增群 =====
    if (action === "add") {
      const { customerId, groupName, activeStatus, packageType, ownerA, ownerB, sales, note, autoAssign, autoSubGroup } = body;
      if (!customerId) return err("客户ID不能为空", 400);

      let finalOwnerA = ownerA, finalOwnerB = ownerB, subGroup = 0;

      // 前端预填了轮转子组编号，直接用并更新 last_assigned
      if (autoSubGroup) {
        const [rows] = await pool.execute(
          "SELECT * FROM group_sub_config WHERE sub_group=? LIMIT 1", [autoSubGroup]
        );
        if (rows.length) {
          subGroup = rows[0].sub_group;
          if (!ownerA) finalOwnerA = rows[0].owner_a;
          if (!ownerB) finalOwnerB = rows[0].owner_b;
          await pool.execute("UPDATE group_sub_config SET last_assigned=NOW() WHERE id=?", [rows[0].id]);
        }
      } else if (autoAssign !== false && (!ownerA || !ownerB)) {
        // 自动轮转分配（未手动指定时）
        const [rows] = await pool.execute(
          "SELECT * FROM group_sub_config ORDER BY last_assigned IS NOT NULL, last_assigned ASC, id ASC LIMIT 1"
        );
        if (!rows.length) return err("子组配置为空，请先配置子组", 500);
        const next = rows[0];
        finalOwnerA = next.owner_a;
        finalOwnerB = next.owner_b;
        subGroup = next.sub_group;
        await pool.execute("UPDATE group_sub_config SET last_assigned=NOW() WHERE id=?", [next.id]);
      } else if (ownerA && ownerB) {
        // 手动指定时，查找对应子组编号（不更新 last_assigned）
        const [rows] = await pool.execute(
          "SELECT sub_group FROM group_sub_config WHERE owner_a=? AND owner_b=? LIMIT 1",
          [ownerA, ownerB]
        );
        subGroup = rows[0]?.sub_group || 0;
      }

      const id = genId();
      await pool.execute(
        "INSERT INTO group_owners (id,customer_id,group_name,active_status,package_type,owner_a,owner_b,sales,note,sub_group) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, customerId, groupName || "", activeStatus || "", packageType || "", finalOwnerA, finalOwnerB, sales || "", note || "", subGroup]
      );
      return ok({ ok: true, id, ownerA: finalOwnerA, ownerB: finalOwnerB, subGroup });
    }

    // ===== 更新群 =====
    if (action === "update") {
      const { id, customerId, groupName, activeStatus, packageType, ownerA, ownerB, sales, note } = body;
      if (!id) return err("缺少 id", 400);
      if (!customerId) return err("客户ID不能为空", 400);
      // 查找子组编号
      const [rows] = await pool.execute(
        "SELECT sub_group FROM group_sub_config WHERE owner_a=? AND owner_b=? LIMIT 1",
        [ownerA || "", ownerB || ""]
      );
      const subGroup = rows[0]?.sub_group || 0;
      await pool.execute(
        "UPDATE group_owners SET customer_id=?,group_name=?,active_status=?,package_type=?,owner_a=?,owner_b=?,sales=?,note=?,sub_group=?,updated_at=NOW() WHERE id=?",
        [customerId, groupName || "", activeStatus || "", packageType || "", ownerA || "", ownerB || "", sales || "", note || "", subGroup, id]
      );
      return ok({ ok: true });
    }

    // ===== 删除群 =====
    if (action === "delete") {
      const { id } = body;
      if (!id) return err("缺少 id", 400);
      await pool.execute("DELETE FROM group_owners WHERE id=?", [id]);
      return ok({ ok: true });
    }

    return err("未知操作: " + action, 400);
  } catch (e) {
    console.error("[groups] error:", e);
    return err(e.message);
  }
};
