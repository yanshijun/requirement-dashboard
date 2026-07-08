// AI 分析报告后端：接收前端「已精确计算好」的结构化指标，用 Qwen 生成叙述研判。
// 关键约束：本函数不碰数据库、不做任何数值计算；所有数字由前端算好传入，AI 只负责写文字。
const QWEN_API_KEY = process.env.QWEN_API_KEY || "sk-09dc3da40982446fba3fae80042ab42c";
const QWEN_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"; // OpenAI 兼容
const QWEN_MODEL = process.env.QWEN_MODEL || "qwen-max";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};
function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }

async function callQwen(system, user) {
  const res = await fetch(`${QWEN_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + QWEN_API_KEY },
    body: JSON.stringify({
      model: QWEN_MODEL,
      enable_thinking: false,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      stream: false
    })
  });
  const data = await res.json();
  if (!data.choices?.[0]) throw new Error("Qwen 返回异常: " + JSON.stringify(data));
  let answer = data.choices[0].message.content || "";
  answer = answer.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { answer, inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 };
}

const SYSTEM_PROMPT = `你是一名资深研发项目经理，正在为公司老板撰写某个版本（计划）的研发进展研判报告。

【最高优先级：数据忠实，严禁编造】
1. 你只能依据用户提供的 JSON 指标数据下结论；数据里没有的信息（例如工时、信号灯颜色数量、化名、行业黑话）一律禁止提及或推断。
2. 所有数字都已由系统精确计算，必须原样引用，禁止自行相加、重新计数或改写（例如"需求总数"是多少就写多少，不要用各阶段数字相加去覆盖它）。
3. 需求名称、编号、人名必须与数据完全一致、逐字照抄，禁止使用"员工A/化名B"之类代称。
4. 严禁做单位换算或曲解字段含义——尤其"进度/平均进度"是完成百分比(0–100%)，绝不是工时、天数或人数。
5. 严禁把不同人、不同需求、不同卡点的信息张冠李戴——每个人只用他自己那一行的数据，卡点处理人与需求认领人是不同角色，不得混为一谈；名称是什么就写什么，不要补全、润色或改写（"接口联调阻塞"就是"接口联调阻塞"）。

【字段口径（务必按此理解）】
- 计数类字段（需求总数、进行中、已上线、负责数、评审中、开发中、测试中、完成、开放/已解决/逾期卡点、各阶段管线数字…）单位都是"个/条"，表示数量。
- "平均进度""进度" = 完成度百分比(0–100%)。
- "工作量分" = 按优先级加权得到的相对负载分（紧急×4/高×2/中×1/低×0.5），不是工时。
- "是否超载" = 布尔值(true/false)。
- "未评审即开发" = 有认领人但研发评审尚未通过就进入开发的需求数（合规风险）。
- 列表里的对象已带"编号/名称/认领人/姓名"等字段，点名时请直接引用这些值。

【写作要求】
面向老板，简洁、抓重点、说人话；用简短分节小标题；不要输出 Markdown 表格；不要寒暄客套；全程中文。`;

function buildUserPrompt(body) {
  const { plan, range, facts, metrics } = body;
  const from = (range && range.from) || "不限";
  const to = (range && range.to) || "不限";
  const scope = `分析范围：计划=${plan || "全部计划"}；时间区间（按需求活动时间）=${from} ~ ${to}。`;
  // 优先用前端拼好的「扁平事实清单」（每条自带标签，最不易被误读）；无则回退 JSON
  const factText = Array.isArray(facts) && facts.length
    ? facts.join("\n")
    : JSON.stringify(metrics || {}, null, 2);
  return `${scope}

以下是系统精确统计得到的事实数据。每一条都必须原样采信：数字与人名/需求名一律照抄，禁止改写、相加、换算或用化名。
================ 事实数据开始 ================
${factText}
================ 事实数据结束 ================

请仅基于上述事实输出研判，分四节：
一、阶段研判：这个版本当前整体处于什么阶段、健康度如何。
二、主要风险与瓶颈：最需要关注的问题（逾期、停滞、卡点、未评审即开发等），按严重程度排序，并点名具体需求与责任人（用事实里的名称）。
三、每个人的工作情况：逐人简评（负责量、进度、是否超载、待处理卡点/逾期），指出亮点和需要跟进的人。
四、下一步建议：给老板和团队的 3-5 条可执行、具体的建议。`;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const action = event.queryStringParameters?.action;
  try {
    if (action === "plan-report") {
      const body = JSON.parse(event.body || "{}");
      if ((!body.facts || !body.facts.length) && !body.metrics) return err("缺少 facts / metrics 数据", 400);
      const { answer, inputTokens, outputTokens } = await callQwen(SYSTEM_PROMPT, buildUserPrompt(body));
      return ok({ summary: answer, inputTokens, outputTokens });
    }
    return err("未知 action: " + action, 400);
  } catch (e) {
    return err(e.message || String(e));
  }
};
