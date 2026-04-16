/**
 * Orchestrator v0.2 — 快模型两段人格化 + 慢模型后台执行
 *
 * 正确设计（老板确认）：
 * - 快模型是两层角色：对人有性格，对慢模型是任务型高效通信
 * - 用户感知：全程人格化，无感知被"委托"
 *
 * 完整流程：
 * 1. 快模型（人格化）→ "好的，请稍候～"         ← 立刻给用户看到
 * 2. 快模型（结构化）→ 发给慢模型任务卡           ← 后台，对用户不可见
 * 3. 慢模型执行 → 返回结构化结果
 * 4. 快模型（人格化）→ "老板，分析好了，结果如下：" + 慢模型结果  ← 第二条回复
 *
 * 两次人格化回复之间是后台处理，用户感知连贯。
 */

import { v4 as uuid } from "uuid";
import type { ChatMessage } from "../types/index.js";
import { callModelFull } from "../models/model-gateway.js";
import { callOpenAIWithOptions } from "../models/providers/openai.js";
import { TaskRepo, MemoryEntryRepo, DelegationArchiveRepo } from "../db/repositories.js";
import { config } from "../config.js";
import { runRetrievalPipeline, buildCategoryAwareMemoryText } from "./memory-retrieval.js";

// ── 委托判断规则 ─────────────────────────────────────────────────────────────

/** 需要委托慢模型的任务类型（扩大范围） */
const NEED_DELEGATION_INTENTS = new Set([
  "reasoning", "math", "code", "research",
  "search", "qa", "general",  // 这些以前直接走快模型，现在大部分也委托
]);

/** 低复杂度阈值（降低门槛，更激进地委托） */
const LOW_COMPLEXITY_THRESHOLD = 15;

/** 高复杂度关键词（有这些词直接委托，不管 intent 是什么） */
const HIGH_COMPLEXITY_KEYWORDS = [
  // 分析研究类
  /分析|研究|调研|对比|比较|评估|考察/i,
  // 搜索资料类
  /搜索|查找|搜集|查询|检索|查一下|帮我找|帮我查|帮我搜/i,
  // 整理归类类
  /整理|归类|分类|汇总|归纳|整理成|整理一下/i,
  // 报告文章类
  /写.*报告|写.*文章|写.*文档|写.*方案|起草|撰写/i,
  // 代码类
  /写.*代码|实现.*算法|debug|调试|编程|写个函数|写个程序/i,
  // 对比选择类
  /哪个好|哪个更好|有什么区别|差异是|优缺点|推荐.*不|建议.*不/i,
  // 信息获取类
  /告诉我.*是什么|什么是|解释一下|说明一下|介绍一下/i,
  // 翻译类
  /翻译成|译成|翻译为|翻译下|英译|中译/i,
  // 摘要总结类
  /总结|概括|提炼|摘要|归纳|要点|核心是/i,
  // 多步骤指示
  /首先.*然后|第一步|接下来|一步步|详细|步骤/i,
  // 任务清单类
  /给我.*清单|列出来|有哪些|都有哪些|全部列出/i,
];

/**
 * 结构性多步判断（快模型无法一句话回复的句式）
 * 命中任一条就委托
 */
const MULTI_STEP_PATTERNS = [
  // 消息很长（超过 80 字符的独立句子，超过 150 字符直接委托）
  (msg: string) => msg.trim().length > 150,
  // 问号超过 1 个
  (msg: string) => (msg.match(/\?/g) || []).length > 1,
  // 句号超过 3 个（多句话，多个要点）
  (msg: string) => (msg.match(/[。.!?]/g) || []).length > 3,
  // 逗号超过 5 个（复合句，条件多）
  (msg: string) => (msg.match(/，|,/g) || []).length > 5,
  // 以句号结尾的非短句（用户自己写了完整问题）
  (msg: string) =>
    /[。.!?]$/.test(msg.trim()) && msg.trim().length > 30,
  // 包含"关于"或"对于"的话题式开头（通常需要展开）
  (msg: string) => /^关于|关于.*，|对于|关于.*和/.test(msg.trim()),
  // 列举类（通常需要完整列出）
  (msg: string) =>
    /①|②|③|\d+个|第一.*第二.*第三|首先.*其次.*最后/i.test(msg),
];

export interface DelegationDecision {
  need_delegation: boolean;
  reason: string;
}

export interface DelegationTaskRecord {
  task_id: string;
  user_id: string;
  session_id: string;
  original_message: string;
  fast_reply: string;
  slow_result?: string;
  status: "pending" | "completed" | "failed";
  created_at: number;
  completed_at?: number;
}

/** 轻量级委托判断（不需要调用模型） */
export function shouldDelegate(
  intent: string,
  complexityScore: number,
  message: string
): DelegationDecision {
  // Step 1: 结构性多步判断（命中即委托，最优先）
  for (const pattern of MULTI_STEP_PATTERNS) {
    if (pattern(message)) {
      return {
        need_delegation: true,
        reason: "结构性多步任务（无法一句话回复）",
      };
    }
  }

  // Step 2: 高复杂度关键词（命中即委托）
  for (const kw of HIGH_COMPLEXITY_KEYWORDS) {
    if (kw.test(message)) {
      return {
        need_delegation: true,
        reason: "高复杂度关键词触发委托",
      };
    }
  }

  // Step 3: 意图明确的任务类型
  if (NEED_DELEGATION_INTENTS.has(intent)) {
    // 低复杂度例外：简单 math（3+5=？）不需要慢模型
    if (intent === "math" && complexityScore < 20 && message.length < 30) {
      return { need_delegation: false, reason: "简单数学不需要慢模型" };
    }
    // 简单 qa/search 但消息短 → 不委托
    if ((intent === "qa" || intent === "search" || intent === "general") && message.length < 25) {
      return { need_delegation: false, reason: `${intent} 但消息极短，快模型直接回复` };
    }
    return {
      need_delegation: true,
      reason: `意图"${intent}"需要慢模型`,
    };
  }

  // Step 4: 复杂度评分偏高 → 委托（门槛降低到 40）
  if (complexityScore >= 40) {
    return {
      need_delegation: true,
      reason: `复杂度评分偏高(${complexityScore})`,
    };
  }

  // 默认不委托，快模型直接回复
  return { need_delegation: false, reason: "简单任务，快模型直接回复" };
}

// ── 快模型系统提示 ─────────────────────────────────────────────────────────────
// 两套完全独立的 prompt：
// 1. 人格化 prompt：直接回复时用，有风格有温度，用户体验好
// 2. 结构化 prompt：委托慢模型时用，极简高效，不人格化，提高效率

/** 人格化快模型 prompt — 直接回复时使用 */
function buildHumanizedFastPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。职责：快速回复用户，口语化、自然，1-2句话足够，不要列清单，不要废话。`;
  }
  return `You are SmartRouter Pro's fast model assistant. Reply quickly, naturally, 1-2 sentences max, no lists, no fluff.`;
}

/** 结构化快模型 prompt — 委托慢模型时使用
 * 负责生成慢模型任务卡（task card），没有人格，高效指令
 * 慢模型任务卡包含：任务描述 + 上下文 + 输出格式要求
 */
function buildStructuredFastPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是一个高效的任务分发助手。
职责：根据用户请求，生成一个结构化的慢模型任务卡。

任务卡格式：
【任务类型】分析/搜索/整理/对比/报告...
【用户请求】<用户的原始问题>
【背景上下文】<相关历史背景，如果有>
【输出要求】<数据支撑/观点明确/格式要求等>

直接输出任务卡，不要有人格描述，不要说"好的"或"我来帮您"，直接开始写任务卡内容。`;
  }
  return `You are an efficient task dispatcher.
Generate a structured task card for the slow model based on the user's request.

Format:
【Task Type】analysis/search/organize/compare/report...
【User Request】<original user question>
【Context】<relevant background if any>
【Output Requirements】<data support/clear opinions/format requirements>

Output only the task card. No greeting, no personality.`;
}

// ── Orchestrator 主函数 ─────────────────────────────────────────────────────────

export interface OrchestratorInput {
  message: string;
  intent: string;
  complexity_score: number;
  language: "zh" | "en";
  user_id: string;
  session_id: string;
  history?: ChatMessage[];
  reqApiKey?: string;
}

export interface OrchestratorResult {
  fast_reply: string;           // 快模型直接返回的回复（不委托时=最终回复；委托时=确认回复）
  delegation?: {
    task_id: string;
    status: "triggered";
  };
  routing_info: {
    intent: string;
    complexity_score: number;
    delegated: boolean;
  };
}

export async function orchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const {
    message, intent, complexity_score, language,
    user_id, session_id, history = [], reqApiKey
  } = input;

  // Step 1: 委托判断
  const decision = shouldDelegate(intent, complexity_score, message);

  // Step 2: 读取用户记忆（人格化回复和慢模型都需要上下文）
  const memories = config.memory.enabled
    ? await MemoryEntryRepo.getTopForUser(user_id, config.memory.maxEntriesToInject)
    : [];

  let memoryText = "";
  if (memories.length > 0) {
    const retrievalResults = memories.map((m) => ({ entry: m, score: m.importance, reason: "v1" }));
    if (config.memory.retrieval.strategy === "v2") {
      const context = { userMessage: message };
      const candidates = await MemoryEntryRepo.getTopForUser(
        user_id, Math.ceil(config.memory.maxEntriesToInject * 1.5)
      );
      const scored = runRetrievalPipeline({
        entries: candidates,
        context,
        categoryPolicy: config.memory.retrieval.categoryPolicy,
        maxTotalEntries: config.memory.maxEntriesToInject,
      });
      if (scored.length > 0) {
        memoryText = buildCategoryAwareMemoryText(scored as any).combined;
      }
    }
    if (!memoryText) {
      memoryText = buildCategoryAwareMemoryText(retrievalResults as any).combined;
    }
  }

  // Step 3: 构造快模型消息（始终用人格化 prompt，委托时只调整 userPrompt 内容）
  const fastSystemPrompt = buildHumanizedFastPrompt(language);
  const userPrompt = message;

  const messages: ChatMessage[] = [
    { role: "system", content: fastSystemPrompt },
    ...history.filter((m) => m.role !== "system").slice(-10),
    { role: "user", content: userPrompt },
  ];

  // Step 4: 调用快模型
  const fastModel = config.fastModel;

  let fastReply: string;
  try {
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(
        fastModel, messages, reqApiKey, config.openaiBaseUrl || undefined
      );
      fastReply = resp.content;
    } else {
      const resp = await callModelFull(fastModel, messages);
      fastReply = resp.content;
    }
  } catch (e: any) {
    console.error("[orchestrator] Fast model call failed:", e.message);
    fastReply = language === "zh"
      ? "抱歉，服务暂时不可用。"
      : "Sorry, the service is temporarily unavailable.";
  }

  // Step 5: 如果需要委托，触发后台慢模型（慢结果包装也在后台做）
  let delegation: OrchestratorResult["delegation"] | undefined;

  if (decision.need_delegation) {
    const taskId = uuid();

    // 异步：慢模型执行 + 快模型包装slowMessage（全部在后台）
    triggerSlowModelBackground({
      taskId,
      message,
      user_id,
      session_id,
      reqApiKey,
      memoryText,
      // slowReply（人格化确认）由本函数返回，慢模型包装结果由后台做
    }).catch((e) => console.error("[orchestrator] Slow model background trigger failed:", e.message));

    delegation = { task_id: taskId, status: "triggered" };
  }

  return {
    fast_reply: fastReply,          // 委托时 = "好的，请稍候～"
    delegation,
    routing_info: {
      intent,
      complexity_score,
      delegated: decision.need_delegation,
    },
  };
}

// ── 后台慢模型触发 ─────────────────────────────────────────────────────────────

interface SlowModelBackgroundInput {
  taskId: string;
  message: string;
  user_id: string;
  session_id: string;
  reqApiKey?: string;
  memoryText: string;
}

/**
 * 后台慢模型触发（O-005/O-006 架构）
 *
 * 完整流程：
 * 1. 快模型（结构化）→ 生成慢模型任务卡（task card）
 * 2. 慢模型执行任务
 * 3. 快模型（人格化）→ 包装慢模型结果（"老板，xxx分析好了，结果如下：..."）
 *
 * 慢模型每个任务独立对话，不累积历史上下文。
 * 档案库记录每次任务，支持后续任务查询相关背景。
 */
async function triggerSlowModelBackground(input: SlowModelBackgroundInput): Promise<void> {
  const { taskId, message, user_id, session_id, reqApiKey, memoryText } = input;
  const startTime = Date.now();

  try {
    // Step 1: 查档案库获取相关历史上下文
    const recentArchives = await DelegationArchiveRepo.getRecentByUser(user_id, 3);
    let archiveContext = "";
    if (recentArchives.length > 0) {
      const archiveLines = recentArchives.map(
        (a) => `[历史任务] ${a.original_message}\n[结果摘要] ${a.slow_result?.substring(0, 200) ?? "(无结果)"}`
      );
      archiveContext = `\n【相关历史背景】（来自档案库，如有必要可参考）\n${archiveLines.join("\n\n")}`;
    }

    // Step 2: 快模型（结构化 prompt）生成慢模型任务卡
    const structuredPrompt = buildStructuredFastPrompt("zh");
    const taskCardMessages: ChatMessage[] = [
      { role: "system", content: structuredPrompt },
      { role: "user", content: `用户请求：${message}${archiveContext ? `\n\n${archiveContext}` : ""}` },
    ];

    let taskCard: string;
    try {
      if (reqApiKey) {
        const resp = await callOpenAIWithOptions(
          config.fastModel, taskCardMessages, reqApiKey, config.openaiBaseUrl || undefined
        );
        taskCard = resp.content;
      } else {
        const resp = await callModelFull(config.fastModel, taskCardMessages);
        taskCard = resp.content;
      }
    } catch (e: any) {
      // 快模型生成任务卡失败时，用规则生成兜底任务卡
      console.warn("[orchestrator] Task card generation failed, using fallback:", e.message);
      taskCard = `【任务类型】分析\n【用户请求】${message}${archiveContext ? `\n\n${archiveContext}` : ""}\n【输出要求】请给出有数据支撑的分析结果。`;
    }

    // Step 3: 慢模型执行任务（独立对话，无历史）
    const slowModel = config.slowModel;
    const slowMessages: ChatMessage[] = [
      { role: "system", content: taskCard },
      { role: "user", content: message },
    ];

    let slowResult: string;
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(
        slowModel, slowMessages, reqApiKey, config.openaiBaseUrl || undefined
      );
      slowResult = resp.content;
    } else {
      const resp = await callModelFull(slowModel, slowMessages);
      slowResult = resp.content;
    }

    const slowModelMs = Date.now() - startTime;

    // Step 4: 快模型（人格化 prompt）包装慢模型结果
    // "老板，xxx分析好了，结果如下：..."
    const wrapMessages: ChatMessage[] = [
      { role: "system", content: buildHumanizedFastPrompt("zh") },
      {
        role: "user",
        content: `用户的问题是："${message}"

慢模型的执行结果如下：
${slowResult}

请用人格化的方式，把上述结果呈现给用户。可以在开头加一句简短的确认语，比如"老板，xxx分析好了"、"我帮您查到了"等。然后直接输出结果，不需要解释过程。`,
      },
    ];

    let slowMessage: string;
    try {
      if (reqApiKey) {
        const resp = await callOpenAIWithOptions(
          config.fastModel, wrapMessages, reqApiKey, config.openaiBaseUrl || undefined
        );
        slowMessage = resp.content;
      } else {
        const resp = await callModelFull(config.fastModel, wrapMessages);
        slowMessage = resp.content;
      }
    } catch (e: any) {
      // 包装失败时，直接返回慢模型结果（兜底）
      console.warn("[orchestrator] Slow message wrapping failed, using raw result:", e.message);
      slowMessage = `我帮您分析好了，结果如下：\n\n${slowResult}`;
    }

    const totalMs = Date.now() - startTime;

    // Step 5: 写入档案（completed 状态）
    await DelegationArchiveRepo.create({
      task_id: taskId,
      user_id,
      session_id,
      original_message: message,
      delegation_prompt: taskCard,
      slow_result: slowResult,
      processing_ms: totalMs,
    });

    // Step 6: 创建任务记录
    await TaskRepo.create({
      id: taskId,
      user_id,
      session_id,
      title: message.substring(0, 100),
      mode: "orchestrator_delegated",
      complexity: "high",
      risk: "low",
      goal: message,
      status: "responding",
    }).catch(() => {});

    await TaskRepo.setStatus(taskId, "completed").catch(() => {});

    // Step 7: 写入 task trace（包含慢模型原始结果和包装后的消息）
    await TaskRepo.createTrace({
      id: uuid(),
      task_id: taskId,
      type: "orchestrator_delegated",
      detail: {
        original_message: message,
        task_card: taskCard,
        slow_result: slowResult,
        slow_message: slowMessage,   // 快模型人格化包装后的完整回复
        processing_ms: totalMs,
        archived: true,
      },
    }).catch(() => {});

  } catch (e: any) {
    console.error(`[orchestrator] Slow model failed for task ${taskId}:`, e.message);

    await DelegationArchiveRepo.fail(taskId, e.message).catch(() => {});
    await TaskRepo.setStatus(taskId, "failed").catch(() => {});
    await TaskRepo.createTrace({
      id: uuid(),
      task_id: taskId,
      type: "orchestrator_delegation_failed",
      detail: { error: e.message, failed_at: Date.now() },
    }).catch(() => {});
  }
}

// ── 查询委托结果（供轮询接口使用）──────────────────────────────────────────────

export interface DelegationResult {
  task_id: string;
  status: "pending" | "completed" | "failed";
  /** 快模型人格化包装后的完整回复，前端直接追加为新消息 */
  slowMessage?: string;
  error?: string;
}

export async function getDelegationResult(taskId: string): Promise<DelegationResult | null> {
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return null;

    const traces = await TaskRepo.getTraces(taskId);
    const delegatedTrace = traces.find((t) => t.type === "orchestrator_delegated");
    const failedTrace = traces.find((t) => t.type === "orchestrator_delegation_failed");

    if (failedTrace) {
      return {
        task_id: taskId,
        status: "failed",
        error: (failedTrace.detail as any)?.error || "Unknown error",
      };
    }

    if (delegatedTrace) {
      const detail = delegatedTrace.detail as any;
      return {
        task_id: taskId,
        status: "completed",
        slowMessage: detail.slow_message, // 快模型人格化包装后的完整回复
      };
    }

    // 还在处理中
    return {
      task_id: taskId,
      status: "pending",
    };
  } catch (e: any) {
    console.error("[orchestrator] getDelegationResult failed:", e.message);
    return null;
  }
}
