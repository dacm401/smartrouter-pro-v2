/**
 * O-007: 测试脚本 — 验证 orchestrator 委托逻辑 + 场景测试
 *
 * 运行方式：
 * node backend/src/test-orchestrator.js
 *
 * 测试场景：
 * 1. 简单问题 → 不委托
 * 2. 复杂问题 → 委托慢模型
 * 3. 多步骤问题 → 委托慢模型
 * 4. 结构性判断 → 委托慢模型
 */

// ── 复制 shouldDelegate 逻辑（独立运行）────────────────────────────────────

/** 需要委托慢模型的任务类型 */
const NEED_DELEGATION_INTENTS = new Set([
  "reasoning", "math", "code", "research",
  "summarization", "creative",
  "translation",
]);

/** 低复杂度阈值 */
const LOW_COMPLEXITY_THRESHOLD = 15;

/** 高复杂度关键词 */
const HIGH_COMPLEXITY_KEYWORDS = [
  /分析|研究|调研|对比|比较|评估|考察/i,
  /搜索|查找|搜集|查询|检索|查一下|帮我找|帮我查|帮我搜/i,
  /整理|归类|分类|汇总|归纳|整理成|整理一下/i,
  /写.*报告|写.*文章|写.*文档|写.*方案|起草|撰写/i,
  /写.*代码|实现.*算法|debug|调试|编程|写个函数|写个程序/i,
  /哪个好|哪个更好|有什么区别|差异是|优缺点|推荐.*不|建议.*不/i,
  /告诉我.*是什么|解释一下.*是什么|介绍一下.*是什么/,
  /翻译成|译成|翻译为|翻译下|英译|中译/i,
  /总结|概括|提炼|摘要|归纳|要点|核心是/i,
  /首先.*然后|第一步|接下来|一步步|详细|步骤/i,
  /给我.*清单|列出来|有哪些|都有哪些|全部列出/i,
];

/** 结构性多步判断 */
const MULTI_STEP_PATTERNS = [
  (msg: string) => msg.trim().length > 150,
  (msg: string) => (msg.match(/\?/g) || []).length > 1,
  (msg: string) => (msg.match(/[。.!?]/g) || []).length > 3,
  (msg: string) => (msg.match(/，|,/g) || []).length > 5,
  (msg: string) => /[。.!?]$/.test(msg.trim()) && msg.trim().length > 30,
  (msg: string) => /^关于|关于.*，|对于|关于.*和/.test(msg.trim()),
  (msg: string) => /①|②|③|\d+个|第一.*第二.*第三|首先.*其次.*最后/i.test(msg),
];

function shouldDelegate(intent: string, complexityScore: number, message: string): { need_delegation: boolean; reason: string } {
  for (const pattern of MULTI_STEP_PATTERNS) {
    if (pattern(message)) {
      return { need_delegation: true, reason: "结构性多步任务" };
    }
  }
  for (const kw of HIGH_COMPLEXITY_KEYWORDS) {
    if (kw.test(message)) {
      return { need_delegation: true, reason: "高复杂度关键词" };
    }
  }
  if (NEED_DELEGATION_INTENTS.has(intent)) {
    if (intent === "math" && complexityScore < 20 && message.length < 30) {
      return { need_delegation: false, reason: "简单数学" };
    }
    if ((intent === "qa" || intent === "search" || intent === "general") && message.length < 25) {
      return { need_delegation: false, reason: "消息极短" };
    }
    return { need_delegation: true, reason: `意图"${intent}"` };
  }
  if (complexityScore >= 35) {
    return { need_delegation: true, reason: `复杂度(${complexityScore})` };
  }
  return { need_delegation: false, reason: "简单任务" };
}

// 测试用例
const testCases = [
  // ── 简单问题（不应委托）──────────────────────────────────────────────
  {
    name: "极短问题",
    message: "你好",
    intent: "chat",
    complexityScore: 10,
    expectedDelegation: false,
  },
  {
    name: "超简单 math",
    message: "3+5等于多少",
    intent: "math",
    complexityScore: 15,
    expectedDelegation: false,
  },
  {
    name: "极短搜索",
    message: "搜一下",
    intent: "search",
    complexityScore: 10,
    expectedDelegation: false,
  },
  {
    name: "简单问好",
    message: "你好啊，今天怎么样",
    intent: "chat",
    complexityScore: 20,
    expectedDelegation: false,
  },

  // ── 分析研究类（应委托）──────────────────────────────────────────────
  {
    name: "分析财务数据",
    message: "帮我分析一下 A 公司和 B 公司的财务数据",
    intent: "research",
    complexityScore: 60,
    expectedDelegation: true,
  },
  {
    name: "对比两个产品",
    message: "对比一下 iPhone 15 和 iPhone 16 的优劣",
    intent: "research",
    complexityScore: 55,
    expectedDelegation: true,
  },
  {
    name: "行业研究",
    message: "分析一下当前AI行业的发展趋势",
    intent: "research",
    complexityScore: 50,
    expectedDelegation: true,
  },

  // ── 搜索资料类（应委托）──────────────────────────────────────────────
  {
    name: "搜索并整理",
    message: "帮我搜索一下深圳房价的最新数据，然后整理成表格",
    intent: "search",
    complexityScore: 45,
    expectedDelegation: true,
  },
  {
    name: "搜集资料",
    message: "搜集一下最近一周的科技新闻",
    intent: "search",
    complexityScore: 40,
    expectedDelegation: true,
  },

  // ── 整理报告类（应委托）──────────────────────────────────────────────
  {
    name: "写报告",
    message: "帮我写一份季度工作总结报告",
    intent: "general",
    complexityScore: 70,
    expectedDelegation: true,
  },
  {
    name: "整理成清单",
    message: "给我列出一个产品经理需要掌握的所有技能清单",
    intent: "general",
    complexityScore: 50,
    expectedDelegation: true,
  },

  // ── 多步骤类（应委托）────────────────────────────────────────────────
  {
    name: "多步骤指示",
    message: "首先登录账号，然后查看用户列表，最后导出CSV文件",
    intent: "general",
    complexityScore: 35,
    expectedDelegation: true,
  },
  {
    name: "详细步骤请求",
    message: "请详细介绍一下如何从零开始学习编程，需要哪些步骤？",
    intent: "qa",
    complexityScore: 45,
    expectedDelegation: true,
  },

  // ── 结构性判断（应委托）──────────────────────────────────────────────
  {
    name: "超长消息",
    message: "关于产品设计的原则，我认为有以下几点需要考虑：第一，用户体验至上，所有的功能设计都应该以用户需求为中心；第二，简洁明了，界面和交互都应该尽量简单直观，减少用户的学习成本；第三，性能优化，无论做什么都要考虑性能影响，确保产品在高并发场景下也能稳定运行。",
    intent: "general",
    complexityScore: 30,
    expectedDelegation: true,
  },
  {
    name: "多问号消息",
    message: "我想了解一下？腾讯的产品有哪些？阿里的呢？字节的呢？这些公司的发展策略有什么不同？",
    intent: "qa",
    complexityScore: 35,
    expectedDelegation: true,
  },
  {
    name: "列举类消息",
    message: "关于智能路由器的功能需求，我有以下几个想法：第一是自动负载均衡，第二是流量监控，第三是安全防护，第四是家长控制",
    intent: "general",
    complexityScore: 30,
    expectedDelegation: true,
  },

  // ── 低复杂度例外（不应委托）─────────────────────────────────────────
  {
    name: "短 math 但低复杂度",
    message: "10+20等于多少",
    intent: "math",
    complexityScore: 15,
    expectedDelegation: false,
  },
  {
    name: "短 qa（实际应为 simple_qa）",
    message: "什么是量子计算",
    intent: "simple_qa",
    complexityScore: 25,
    expectedDelegation: false,
  },
];

// 运行测试
console.log("=".repeat(60));
console.log("O-007: Orchestrator 委托逻辑测试");
console.log("=".repeat(60));

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = shouldDelegate(tc.intent, tc.complexityScore, tc.message);
  const ok = result.need_delegation === tc.expectedDelegation;

  const icon = ok ? "✅" : "❌";
  const status = ok ? "PASS" : "FAIL";

  console.log(`\n${icon} [${status}] ${tc.name}`);
  console.log(`   消息: "${tc.message.substring(0, 40)}${tc.message.length > 40 ? "..." : ""}"`);
  console.log(`   Intent: ${tc.intent}, 复杂度: ${tc.complexityScore}`);
  console.log(`   预期委托: ${tc.expectedDelegation}, 实际: ${result.need_delegation}`);
  console.log(`   原因: ${result.reason}`);

  if (ok) {
    passed++;
  } else {
    failed++;
  }
}

console.log("\n" + "=".repeat(60));
console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
console.log("=".repeat(60));

// 场景模拟测试
console.log("\n\n" + "=".repeat(60));
console.log("场景模拟测试 — 用户对话流程");
console.log("=".repeat(60));

const scenarios = [
  {
    name: "场景1: 用户问复杂问题",
    steps: [
      { user: "帮我分析一下 A 公司和 B 公司的财务数据，给出对比表格", expected: "委托慢模型" },
    ],
  },
  {
    name: "场景2: 用户追问进度",
    steps: [
      { user: "帮我分析一下 A 公司和 B 公司的财务数据，给出对比表格", expected: "委托慢模型" },
      { user: "出来了吗？", expected: "安抚回复（快模型）" },
      { user: "还在处理吗？会不会卡住了？", expected: "安抚回复（快模型）" },
    ],
  },
  {
    name: "场景3: 简单对话中间穿插复杂问题",
    steps: [
      { user: "你好啊", expected: "直接回复（快模型）" },
      { user: "帮我分析一下当前经济形势", expected: "委托慢模型" },
      { user: "好的", expected: "直接回复（快模型）" },
    ],
  },
];

for (const scenario of scenarios) {
  console.log(`\n📋 ${scenario.name}`);
  console.log("-".repeat(40));

  for (const step of scenario.steps) {
    const intent = step.user.includes("分析") || step.user.includes("对比") ? "research" :
                   step.user.includes("你好") || step.user === "好的" ? "chat" : "general";
    const complexity = step.user.includes("分析") ? 60 : step.user.includes("卡住") ? 10 : 20;
    const result = shouldDelegate(intent, complexity, step.user);

    console.log(`  用户: "${step.user}"`);
    console.log(`  预期: ${step.expected}`);
    console.log(`  实际: ${result.need_delegation ? "委托慢模型" : "快模型回复（" + result.reason + "）"}`);
  }
}
