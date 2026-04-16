/**
 * Orchestrator v0.1 — 快模型先回复 + 委托慢模型后台执行
 *
 * 核心流程：
 * 1. 快模型先用精简 system prompt 生成初步回复（不等待慢模型）
 * 2. 判断是否需要委托慢模型（基于 intent + complexity）
 * 3. 如果需要委托：后台触发慢模型，写入委托任务表
 * 4. 快模型回复中告知用户"慢模型正在后台处理"
 * 5. 前端轮询 /chat-result/:taskId 获取慢模型最终结果
 *
 * 关键设计：快模型不推理，只整理和分发。
 * 判断委托的逻辑在代码层（轻量规则），不增加快模型负担。
 */

import { v4 as uuid } from "uuid";
import type { ChatMessage } from "../types/index.js";
import { callModelFull, callModelStream } from "../models/model-gateway.js";
import { callOpenAIWithOptions } from "../models/providers/openai.js";
import { TaskRepo } from "../db/repositories.js";
import { config } from "../config.js";
import { MemoryEntryRepo } from "../db/repositories.js";
import { runRetrievalPipeline, buildCategoryAwareMemoryText } from "./memory-retrieval.js";
import { assemblePrompt } from "./prompt-assembler.js";

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
  fast_reply_suffix?: string; // 快模型回复末尾追加的提示语
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
        fast_reply_suffix: "这个问题需要完整分析，我让慢模型在后台处理……",
      };
    }
  }

  // Step 2: 高复杂度关键词（命中即委托）
  for (const kw of HIGH_COMPLEXITY_KEYWORDS) {
    if (kw.test(message)) {
      return {
        need_delegation: true,
        reason: "高复杂度关键词触发委托",
        fast_reply_suffix: "这是一个复杂的分析任务，我让慢模型在后台处理……",
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
      fast_reply_suffix: "这个问题需要更深入的分析，我让慢模型在后台处理……",
    };
  }

  // Step 4: 复杂度评分偏高 → 委托（门槛降低到 40）
  if (complexityScore >= 40) {
    return {
      need_delegation: true,
      reason: `复杂度评分偏高(${complexityScore})`,
      fast_reply_suffix: "这个问题比较复杂，我让慢模型在后台处理……",
    };
  }

  // 默认不委托，快模型直接回复
  return { need_delegation: false, reason: "简单任务，快模型直接回复" };
}

// ── 快模型系统提示（极度精简，不含任何判断逻辑） ─────────────────────────────────

function buildOrchestratorFastPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。职责：快速回复用户，口语化、自然，1-2句话足够，不要列清单，不要废话。`;
  }
  return `You are SmartRouter Pro's fast model assistant. Reply quickly, naturally, 1-2 sentences max, no lists, no fluff.`;
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
  fast_reply: string;           // 快模型直接返回的回复
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

  // Step 2: 构造快模型消息
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

  // 构建快模型 system prompt（精简版，只有人格和直接回复规则，没有慢模型人格）
  const fastSystemPrompt = buildOrchestratorFastPrompt(language);

  const userPrompt = decision.need_delegation
    ? `${message}\n\n[系统指令] 这个问题需要委托慢模型处理。请先给用户一个简洁的初步回复（1-3句话），然后告知用户你已让慢模型在后台处理。不要等慢模型结果，直接回复。`
    : message;

  const messages: ChatMessage[] = [
    { role: "system", content: fastSystemPrompt },
    ...history.filter((m) => m.role !== "system").slice(-10), // 保留最近10轮
    { role: "user", content: userPrompt },
  ];

  // Step 3: 调用快模型（直接调用，不走 manageContext，因为 system prompt 已经精简）
  const fastModel = reqApiKey
    ? config.fastModel
    : config.fastModel;

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
    // 快模型失败时给一个兜底回复
    fastReply = language === "zh"
      ? "抱歉，快模型暂时不可用。请稍后再试。"
      : "Sorry, the fast model is temporarily unavailable. Please try again.";
  }

  // Step 4: 如果需要委托，触发后台慢模型
  let delegation: OrchestratorResult["delegation"] | undefined;

  if (decision.need_delegation) {
    const taskId = uuid();

    // 异步触发慢模型（不等待完成）
    triggerSlowModelBackground({
      taskId,
      message,
      user_id,
      session_id,
      fast_reply: fastReply,
      reqApiKey,
      history, // 传递历史上下文给慢模型
    }).catch((e) => console.error("[orchestrator] Slow model background trigger failed:", e.message));

    delegation = { task_id: taskId, status: "triggered" };
  }

  return {
    fast_reply: fastReply,
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
  fast_reply: string;
  reqApiKey?: string;
  history?: ChatMessage[]; // 传入历史上下文
}

async function triggerSlowModelBackground(input: SlowModelBackgroundInput): Promise<void> {
  const { taskId, message, user_id, session_id, fast_reply, reqApiKey, history = [] } = input;

  try {
    // 创建任务记录
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
    });

    // 读取记忆（与 orchestrator 相同的逻辑）
    const memories = config.memory.enabled
      ? await MemoryEntryRepo.getTopForUser(user_id, config.memory.maxEntriesToInject)
      : [];

    let memoryText = "";
    if (memories.length > 0) {
      const retrievalResults = memories.map((m) => ({ entry: m, score: m.importance, reason: "v1" }));
      memoryText = buildCategoryAwareMemoryText(retrievalResults as any).combined;
    }

    // 构造慢模型 prompt（用 prompt-assembler，模式为 research）
    const promptAssembly = assemblePrompt({
      mode: "research",
      modelMode: "slow",
      intent: "reasoning",
      userMessage: message,
      memoryText: memoryText || undefined,
      maxTaskSummaryTokens: config.memory.maxEntriesToInject * config.memory.maxTokensPerEntry,
      lang: "zh",
    });

    const systemPrompt = promptAssembly.systemPrompt;
    // 慢模型读取最近 5 轮历史，保持上下文
    const recentHistory = history
      .filter((m) => m.role !== "system")
      .slice(-10);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: message },
    ];

    // 调用慢模型
    const slowModel = config.slowModel;
    let slowResult: string;

    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(
        slowModel, messages, reqApiKey, config.openaiBaseUrl || undefined
      );
      slowResult = resp.content;
    } else {
      const resp = await callModelFull(slowModel, messages);
      slowResult = resp.content;
    }

    // 更新任务状态为 completed（写入 slow_result）
    await TaskRepo.setStatus(taskId, "completed").catch(() => {});

    // 将慢模型结果写入 evidence 或专门的委托结果表
    // 目前用 task trace 暂存，后续可扩展为专门的 delegation_results 表
    await TaskRepo.createTrace({
      id: uuid(),
      task_id: taskId,
      type: "orchestrator_delegated",
      detail: {
        original_message: message,
        fast_reply,
        slow_result: slowResult,
        delegated_at: Date.now(),
        completed_at: Date.now(),
      },
    }).catch((e) => console.error("[orchestrator] Failed to write slow result trace:", e.message));

  } catch (e: any) {
    console.error(`[orchestrator] Slow model failed for task ${taskId}:`, e.message);
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
  fast_reply?: string;
  slow_result?: string;
  error?: string;
}

export async function getDelegationResult(taskId: string): Promise<DelegationResult | null> {
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return null;

    // 从 trace 中读取慢模型结果
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
        status: task.status as "pending" | "completed" | "failed",
        fast_reply: detail.fast_reply,
        slow_result: detail.slow_result,
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
