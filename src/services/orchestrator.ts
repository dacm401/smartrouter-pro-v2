/**
 * Orchestrator v0.4 — LLM-Native 路由架构
 *
 * 核心变化（v0.3 → v0.4）：
 * - 删除了 shouldDelegate() 硬编码判断规则
 * - Fast 模型自判断：直接回复 / 调用 web_search / 请求升级慢模型
 * - Fast → Slow = 结构化 JSON command，不再传上下文
 * - Archive 为唯一事实源（Phase 1 引入后生效）
 *
 * 决策流程（Fast 模型自判断）：
 * 1. 用户是否闲聊/打招呼？ → 直接回复，1-2句话
 * 2. 是否需要实时数据？ → 调用 web_search → 返回结果
 * 3. 是否需要慢模型？ → 输出【SLOW_MODEL_REQUEST】JSON command
 * 4. 以上都不是 → 直接回复
 */

import { v4 as uuid } from "uuid";
import type { ChatMessage } from "../types/index.js";
import { callModelFull } from "../models/model-gateway.js";
import { callOpenAIWithOptions } from "../models/providers/openai.js";
import type { ModelResponse } from "../models/providers/base-provider.js";
import { TaskRepo, MemoryEntryRepo, DelegationArchiveRepo } from "../db/repositories.js";
import { TaskArchiveRepo } from "../db/task-archive-repo.js";
import { config } from "../config.js";
import { runRetrievalPipeline, buildCategoryAwareMemoryText } from "./memory-retrieval.js";
import { FAST_MODEL_TOOLS } from "./fast-model-tools.js";
import { toolExecutor } from "../tools/executor.js";

// ── Manager Synthesis ─────────────────────────────────────────────────────────

const MANAGER_SYNTHESIS_PROMPT = {
  zh: (workerResult: string) =>
`用户的问题已经被执行专家分析完毕。
下面是执行专家的原始分析结果：

---
${workerResult}
---

请将以上分析结果整合成一段自然、简洁的回复，直接面向用户。
要求：
- 不重复"以下是分析结果"等废话
- 直接用自然的段落或要点呈现结论
- 如果有多个发现，按重要性排序
- 如果有数据或引用，说明来源
- 保持与用户对话的语气，不要写成报告`,
  en: (workerResult: string) =>
`The user's question has been analyzed by the execution specialist.
Here is the specialist's raw analysis:

---
${workerResult}
---

Please synthesize this into a natural, concise response for the user.
Requirements:
- Don't repeat filler like "Here are the analysis results"
- Present conclusions naturally as paragraphs or bullet points
- If multiple findings, order by importance
- If data or citations, mention the source
- Keep a conversational tone, not a report style`,
};

async function synthesizeManagerOutput(
  taskId: string,
  workerResult: string,
  confidence: number,
  lang: "zh" | "en"
): Promise<string | null> {
  try {
    // 读取原始 archive（获取用户原始输入）
    const archive = await TaskArchiveRepo.getById(taskId);
    if (!archive) return workerResult;

    const userInput = archive.user_input ?? "";

    const systemPrompt = lang === "zh"
      ? "你是 SmartRouter Pro 的管理模型（Manager）。负责把执行专家的结果整合成最终回复。"
      : "You are SmartRouter Pro's Manager model. Your job is to synthesize execution results into the final user-facing response.";

    const userPrompt = MANAGER_SYNTHESIS_PROMPT[lang](workerResult);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `用户原始问题：${userInput}\n\n${userPrompt}` },
    ];

    const resp = await callModelFull(config.fastModel, messages);
    return resp.content.trim() || workerResult;
  } catch (e: any) {
    console.warn("[synthesizeManagerOutput] Manager synthesis failed:", e.message);
    return null;
  }
}

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  message: string;
  language: "zh" | "en";
  user_id: string;
  session_id: string;
  history?: ChatMessage[];
  reqApiKey?: string;
  hasPendingTask?: boolean;       // O-007: 是否有 pending 慢任务（安抚用）
  pendingTaskMessage?: string;     // O-007: pending 任务原始消息
}

export interface OrchestratorResult {
  fast_reply: string;
  delegation?: {
    task_id: string;
    status: "triggered";
  };
  // Phase 1.5: Clarifying 流程
  clarifying?: ClarifyQuestion;
  routing_info: {
    delegated: boolean;
    tool_used?: string;            // 如 "web_search"
    is_reassuring?: boolean;       // O-007: 是否是安抚回复
    routing_intent?: string;       // 路由意图（供 benchmark 使用）
    clarify_requested?: boolean;   // Phase 1.5: Fast 请求澄清
  };
}

/** Slow 模型升级命令（从 Fast 模型输出中解析） */
export interface SlowModelCommand {
  action: "research" | "analysis" | "code" | "creative" | "comparison";
  task: string;
  constraints: string[];
  query_keys: string[];
  // Phase 1.5: 任务卡片扩展字段
  relevant_facts?: string[];
  user_preference_summary?: string;
  priority?: "high" | "normal" | "low";
  max_execution_time_ms?: number;
}

/** Phase 1.5: 澄清问题（Fast → 前端） */
export interface ClarifyQuestion {
  question_id: string;
  question_text: string;
  options?: string[];    // 多选时提供选项
  context: string;       // 触发澄清的上下文
}

// ── O-007 安抚 prompt ─────────────────────────────────────────────────────────

function buildReassuringFastPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。职责：快速回复用户，口语化，自然，1-2句话足够。
当检测到用户询问之前委托任务的进度时（如"出来了吗"、"好了吗"、"还在处理吗"等），
请用人格化的方式安抚用户，告知正在处理中，不要暴露"委托"或"慢模型"等技术细节。
示例回复：
- "还在分析中哦，请稍候～"
- "老板，稍等一下，马上就好啦～"
- "正在为您处理，马上呈现结果～"`;
  }
  return `You are SmartRouter Pro's fast model assistant.
When user asks about task progress (e.g., "done?", "is it ready?", "still processing?"),
reply in a friendly, reassuring way without mentioning technical details like "delegation" or "slow model".`;
}

// ── Fast 模型系统 prompt（LLM-Native 路由版）─────────────────────────────────

function buildFastModelSystemPrompt(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是 SmartRouter Pro 的快模型助手。

【决策规则】
收到用户请求后，依次判断：

1. 用户是否只是闲聊/打招呼/情绪表达？
   → 直接回复，1-2句话，有温度

2. 问题是否需要实时数据（天气/新闻/股价/比分/任何你不确定的事）？
   → 调用 web_search 工具获取数据，再回答

3. 用户的请求是否模糊、缺少关键信息（如目标、范围、格式）？
   → 用【CLARIFYING_REQUEST】格式输出（见下方），向用户提问确认

4. 问题是否超出你的知识截止日期，或需要多步复杂推理？
   → 用【SLOW_MODEL_REQUEST】格式输出（见下方），请求升级到更强模型

5. 以上都不是？
   → 用你的内建知识直接回答，简短，自然

【web_search 使用时机】
- 天气查询
- 实时股价、指数、基金净值
- 最新新闻、公告
- 比分、赛果
- 任何你不确定、需要确认的实时信息
- 你的知识截止日期之后发生的事

【澄清请求格式】（第3条触发）
输出1-2句自然语言问题，然后输出单行JSON（不包裹代码块）：

【CLARIFYING_REQUEST】
{"question_text": "你想要哪种格式的报告？", "options": ["表格", "Markdown", "JSON"]}
【/CLARIFYING_REQUEST】

然后停止输出，等待用户回复。

【慢模型请求格式】（第4条触发）
先用1-2句自然语言告知用户（如"让我想想"、"这个问题有点深"），然后输出单行JSON（不包裹代码块）：

【SLOW_MODEL_REQUEST】
{"action": "research|analysis|code|creative|comparison", "task": "核心任务描述（<100字）", "constraints": ["约束1", "约束2"], "query_keys": ["关键词1"], "priority": "normal", "relevant_facts": [], "user_preference_summary": ""}
【/SLOW_MODEL_REQUEST】

然后停止输出，等待处理。`;
  }
  return `You are SmartRouter Pro's fast model assistant.

【Decision Rules】
After receiving the user's request, judge in order:

1. Is the user just chatting/greeting/emotional expression?
   → Reply directly, 1-2 sentences, with warmth

2. Does the question need real-time data (weather/news/stocks/scores/anything you're unsure about)?
   → Call web_search tool to get data, then answer

3. Is the request ambiguous or missing key information (goal/scope/format)?
   → Output in 【CLARIFYING_REQUEST】 format (see below), ask the user to clarify

4. Does the question exceed your knowledge cutoff, or require multi-step complex reasoning?
   → Output in 【SLOW_MODEL_REQUEST】 format (see below), request escalation

5. None of the above?
   → Answer directly with your built-in knowledge, concise and natural.

【Clarifying Request Format】(Rule 3)
Say 1-2 natural sentences asking for clarification, then output single-line JSON (no code block):

【CLARIFYING_REQUEST】
{"question_text": "What format do you want the report in?", "options": ["table", "Markdown", "JSON"]}
【/CLARIFYING_REQUEST】

Then stop and wait for user response.

【Slow Model Request Format】(Rule 4)
First say 1-2 natural sentences (e.g. "Let me think about this"), then output single-line JSON (no code block):

【SLOW_MODEL_REQUEST】
{"action": "research|analysis|code|creative|comparison", "task": "Core task description (<100 chars)", "constraints": ["constraint1"], "query_keys": ["keyword1"], "priority": "normal", "relevant_facts": [], "user_preference_summary": ""}
【/SLOW_MODEL_REQUEST】

Then stop outputting and wait for processing.`;
}

// ── Slow 模型升级命令解析 ─────────────────────────────────────────────────────

/**
 * 从 Fast 模型输出中解析【SLOW_MODEL_REQUEST】命令
 */
function parseSlowModelCommand(text: string): SlowModelCommand | null {
  let jsonStr: string | null = null;

  // 格式 1：代码块内的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) { jsonStr = codeBlockMatch[1].trim(); }

  // 格式 2：单独一行的 JSON
  if (!jsonStr) {
    const jsonLineMatch = text.match(/(\{[^{}]*"action"[\s\S]*?\})/);
    if (jsonLineMatch) { jsonStr = jsonLineMatch[1]; }
  }

  // 格式 3：包含在【SLOW_MODEL_REQUEST】标记中
  if (!jsonStr) {
    const tagMatch = text.match(/【SLOW_MODEL_REQUEST】\s*(\{[\s\S]*?\})\s*【\/SLOW_MODEL_REQUEST】/);
    if (tagMatch) { jsonStr = tagMatch[1]; }
  }

  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.action || !parsed.task) return null;
    return {
      action: parsed.action,
      task: parsed.task,
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
      query_keys: Array.isArray(parsed.query_keys) ? parsed.query_keys : [],
      // Phase 1.5 扩展字段
      relevant_facts: Array.isArray(parsed.relevant_facts) ? parsed.relevant_facts : undefined,
      user_preference_summary: typeof parsed.user_preference_summary === "string" ? parsed.user_preference_summary : undefined,
      priority: (parsed.priority === "high" || parsed.priority === "normal" || parsed.priority === "low") ? parsed.priority : undefined,
      max_execution_time_ms: typeof parsed.max_execution_time_ms === "number" ? parsed.max_execution_time_ms : undefined,
    };
  } catch {
    return null;
  }
}

/** Phase 1.5: 从 Fast 模型输出中解析【CLARIFYING_REQUEST】 */
function parseClarifyQuestion(text: string): ClarifyQuestion | null {
  let jsonStr: string | null = null;

  // 格式1：包含在【CLARIFYING_REQUEST】标记中
  const tagMatch = text.match(/【CLARIFYING_REQUEST】\s*(\{[\s\S]*?\})\s*【\/CLARIFYING_REQUEST】/);
  if (tagMatch) { jsonStr = tagMatch[1]; }

  // 格式2：单行JSON（兼容无标记格式）
  if (!jsonStr) {
    const jsonLineMatch = text.match(/(\{"question_text"[\s\S]*?\})/);
    if (jsonLineMatch) { jsonStr = jsonLineMatch[1]; }
  }

  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.question_text) return null;
    return {
      question_id: uuid(),
      question_text: parsed.question_text,
      options: Array.isArray(parsed.options) ? parsed.options : undefined,
      context: parsed.context || "",
    };
  } catch {
    return null;
  }
}

// ── Fast 模型工具调用循环 ────────────────────────────────────────────────────

async function callFastModelWithTools(
  messages: ChatMessage[],
  lang: "zh" | "en",
  reqApiKey?: string
): Promise<{ reply: string; toolUsed?: string; command?: SlowModelCommand; clarifyQuestion?: ClarifyQuestion }> {
  const MAX_TOOL_ROUNDS = 5;
  let currentMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: ModelResponse;

    if (reqApiKey) {
      // 使用 callOpenAIWithOptions（已支持 tools）
      response = await callOpenAIWithOptions(
        config.fastModel, currentMessages, reqApiKey, config.openaiBaseUrl || undefined, FAST_MODEL_TOOLS
      );
    } else {
      // 无 reqApiKey 时，使用 callModelFull（已支持 tools 参数）
      response = await callModelFull(config.fastModel, currentMessages, FAST_MODEL_TOOLS);
    }

    const { content, tool_calls } = response;

    // 情况 1：有 tool_calls → 执行 → 注入结果 → 继续
    if (tool_calls && tool_calls.length > 0) {
      const toolResults: ChatMessage[] = [];

      for (const tc of tool_calls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }

        const result = await toolExecutor.execute(
          { id: tc.id, tool_name: toolName, arguments: args },
          { userId: "fast-model", sessionId: "fast-session" }
        );

        const resultContent = result.success
          ? JSON.stringify(result.result)
          : `工具执行失败: ${result.error}`;

        toolResults.push({
          role: "tool" as const,
          content: resultContent,
          tool_call_id: tc.id,
        });
      }

      currentMessages.push({ role: "assistant", content });
      currentMessages.push(...toolResults);
      continue;
    }

    // 情况 2：无 tool_calls → 检查澄清请求（Phase 1.5）
    if (content) {
      const clarifyQ = parseClarifyQuestion(content);
      if (clarifyQ) {
        const prefix = content
          .replace(/【CLARIFYING_REQUEST】[\s\S]*?【\/CLARIFYING_REQUEST】/, "")
          .trim();
        return {
          reply: prefix || (lang === "zh" ? "我需要确认一下..." : "Let me clarify..."),
          clarifyQuestion: clarifyQ,
        };
      }
      // 情况 3：检查慢模型升级请求
      const command = parseSlowModelCommand(content);
      if (command) {
        const prefix = content
          .replace(/【SLOW_MODEL_REQUEST】[\s\S]*?【\/SLOW_MODEL_REQUEST】/, "")
          .trim();
        return {
          reply: prefix || (lang === "zh" ? "让我想想..." : "Let me think..."),
          command,
        };
      }
      // 情况 4：普通回复
      return { reply: content };
    }

    return { reply: "" };
  }

  // 超过最大轮次
  return { reply: currentMessages[currentMessages.length - 1]?.content || "" };
}

// ── Orchestrator 主函数 ───────────────────────────────────────────────────────

export async function orchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const {
    message, language,
    user_id, session_id, history = [], reqApiKey,
    hasPendingTask = false, pendingTaskMessage
  } = input;

  // Step 0: O-007 安抚
  if (hasPendingTask) {
    const reassuringPrompt = buildReassuringFastPrompt(language);
    const historyContext = history.filter((m) => m.role !== "system").slice(-6);
    const pendingContext = pendingTaskMessage ? `\n\n【当前正在处理的任务】${pendingTaskMessage}` : "";

    const messages: ChatMessage[] = [
      { role: "system", content: reassuringPrompt },
      ...historyContext,
      { role: "user", content: `用户问题是："${message}"${pendingContext}` },
    ];

    let fastReply: string;
    try {
      if (reqApiKey) {
        const resp = await callOpenAIWithOptions(config.fastModel, messages, reqApiKey, config.openaiBaseUrl || undefined);
        fastReply = resp.content;
      } else {
        const resp = await callModelFull(config.fastModel, messages);
        fastReply = resp.content;
      }
    } catch (e: any) {
      console.error("[orchestrator] Reassuring call failed:", e.message);
      fastReply = language === "zh" ? "正在为您处理中，请稍候～" : "Still processing, please wait...";
    }

    return { fast_reply: fastReply, routing_info: { delegated: false, is_reassuring: true } };
  }

  // Step 1: 读取用户记忆（Fast 模型内建知识补充）
  const memories = config.memory.enabled
    ? await MemoryEntryRepo.getTopForUser(user_id, config.memory.maxEntriesToInject)
    : [];

  let memoryText = "";
  if (memories.length > 0) {
    const retrievalResults = memories.map((m) => ({ entry: m, score: m.importance, reason: "v1" }));
    if (config.memory.retrieval.strategy === "v2") {
      const candidates = await MemoryEntryRepo.getTopForUser(user_id, Math.ceil(config.memory.maxEntriesToInject * 1.5));
      const scored = runRetrievalPipeline({
        entries: candidates,
        context: { userMessage: message },
        categoryPolicy: config.memory.retrieval.categoryPolicy,
        maxTotalEntries: config.memory.maxEntriesToInject,
      });
      if (scored.length > 0) memoryText = buildCategoryAwareMemoryText(scored as any).combined;
    }
    if (!memoryText) memoryText = buildCategoryAwareMemoryText(retrievalResults as any).combined;
  }
  void memoryText; // 暂时保留，Slow 模型从 Archive 查上下文，不再传 memoryText

  // Step 2: 构造 Fast 模型消息
  const systemPrompt = buildFastModelSystemPrompt(language);
  const historyMessages = history.filter((m) => m.role !== "system").slice(-10);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: message },
  ];

  // Step 3: 调用 Fast 模型（带工具）
  const { reply, toolUsed, command, clarifyQuestion } = await callFastModelWithTools(messages, language, reqApiKey);

  // Phase 1.5: Fast 请求澄清 → 直接返回
  if (clarifyQuestion) {
    return {
      fast_reply: reply,
      clarifying: clarifyQuestion,
      routing_info: { delegated: false, tool_used: toolUsed, clarify_requested: true },
    };
  }

  // Step 4: Fast 请求慢模型升级 → 创建 TaskArchive → 后台执行
  if (command) {
    const taskId = uuid();

    // 写入 TaskArchive（Fast → Slow 的结构化命令）
    try {
      await TaskArchiveRepo.create({
        task_id: taskId,
        session_id,
        command,
        user_input: message,
        constraints: command.constraints,
      });
    } catch (e: any) {
      console.warn("[orchestrator] TaskArchive create failed:", e.message);
      // Archive 写失败不阻止慢模型执行，继续
    }

    // 后台触发慢模型
    triggerSlowModelBackground({
      taskId,
      message,
      command,
      user_id,
      session_id,
      reqApiKey,
    }).catch((e) => console.error("[orchestrator] Slow model trigger failed:", e.message));

    return {
      fast_reply: reply,
      delegation: { task_id: taskId, status: "triggered" },
      routing_info: { delegated: true },
    };
  }

  // Step 5: Fast 直接回复
  return {
    fast_reply: reply,
    routing_info: { delegated: false, tool_used: toolUsed },
  };
}

// ── 后台慢模型触发 ───────────────────────────────────────────────────────────

interface SlowModelBackgroundInput {
  taskId: string;
  message: string;
  command: SlowModelCommand;
  user_id: string;
  session_id: string;
  reqApiKey?: string;
}

export async function triggerSlowModelBackground(input: SlowModelBackgroundInput): Promise<void> {
  const { taskId, message, command, user_id, session_id, reqApiKey } = input;
  const startTime = Date.now();

  try {
    // Step 1: 更新 Archive 状态为 running
    await TaskArchiveRepo.updateStatus(taskId, "running");

    // Step 2: 查历史档案获取相关上下文
    const recentArchives = await DelegationArchiveRepo.getRecentByUser(user_id, 3);
    let archiveContext = "";
    if (recentArchives.length > 0) {
      const lines = recentArchives.map(
        (a) => `[历史任务] ${a.original_message}\n[结果摘要] ${a.slow_result?.substring(0, 200) ?? "(无结果)"}`
      );
      archiveContext = `\n【相关历史背景】\n${lines.join("\n\n")}`;
    }

    // Step 3: 构造 Phase 1.5 Task Brief（只读，不含历史对话）
    const taskBrief = {
      task_type: command.action,
      instruction: command.task,
      constraints: command.constraints,
      output_format: "markdown",
      relevant_facts: command.relevant_facts || [],
      user_preference_summary: command.user_preference_summary || "",
      priority: command.priority || "normal",
      max_execution_time_ms: command.max_execution_time_ms || 60000,
    };
    const taskCard = "【任务卡片 — Phase 1.5 只读模式】\n" +
      "你是执行者。任务信息在上面的任务卡片中。\n" +
      "【重要】不要读取任何外部历史对话，只使用任务卡片中的信息。\n" +
      "如果需要了解用户偏好，使用 user_preference_summary 字段。\n" +
      "如果需要相关事实，使用 relevant_facts 字段。\n\n" +
      "【任务卡片】\n" + JSON.stringify(taskBrief, null, 2) + "\n\n" +
      "【输出约束】\n" + command.constraints.map((c) => "- " + c).join("\n") +
      (archiveContext ? "\n\n【相关历史背景】（仅作参考，不要复制）\n" + archiveContext : "");

    // Step 4: 慢模型执行（独立对话，无历史累积）
    const slowModel = config.slowModel;
    const slowMessages: ChatMessage[] = [
      { role: "system", content: taskCard },
      { role: "user", content: message },
    ];

    let slowResult: string;
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(slowModel, slowMessages, reqApiKey, config.openaiBaseUrl || undefined);
      slowResult = resp.content;
    } else {
      const resp = await callModelFull(slowModel, slowMessages);
      slowResult = resp.content;
    }

    const totalMs = Date.now() - startTime;

    // Step 5: 写入 Archive 执行结果
    await TaskArchiveRepo.writeExecution({
      id: taskId,
      status: "done",
      result: slowResult,
      started_at: new Date(startTime).toISOString(),
      deviations: [],
    });

    // Step 6: 写入 delegation_archive（兼容旧接口，供 hasPending 查询使用）
    await DelegationArchiveRepo.create({
      task_id: taskId,
      user_id,
      session_id,
      original_message: message,
      delegation_prompt: taskCard,
      slow_result: slowResult,
      processing_ms: totalMs,
    });

    // Step 7: 任务记录
    await TaskRepo.create({
      id: taskId, user_id, session_id,
      title: message.substring(0, 100),
      mode: "llm_native_delegated",
      complexity: "high",
      risk: "low",
      goal: message,
      status: "responding",
    }).catch(() => {});
    await TaskRepo.setStatus(taskId, "completed").catch(() => {});

    // Step 8: 写 trace
    await TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "llm_native_delegated",
      detail: { original_message: message, command, slow_result: slowResult, processing_ms: totalMs, archived: true },
    }).catch(() => {});

  } catch (e: any) {
    console.error(`[orchestrator] Slow model failed for task ${taskId}:`, e.message);
    await TaskArchiveRepo.writeExecution({
      id: taskId,
      status: "failed",
      errors: [e.message],
    }).catch(() => {});
    await DelegationArchiveRepo.fail(taskId, e.message).catch(() => {});
    await TaskRepo.setStatus(taskId, "failed").catch(() => {});
    await TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "llm_native_delegation_failed",
      detail: { error: e.message, failed_at: Date.now() },
    }).catch(() => {});
  }
}

// ── Routing Layer 常量（Phase 2.0 显式分层）───────────────────────────────────
/**
 * Layer 0: Fast 直接回复（闲聊/简单问答，无工具调用）
 * Layer 1: Fast + web_search（需要实时数据）
 * Layer 2: Slow 模型委托（复杂推理/多步任务）
 * Layer 3: Execute 模式（任务规划 + 工具执行，Phase C）
 */
export type RoutingLayer = "L0" | "L1" | "L2" | "L3";

export function inferRoutingLayer(result: OrchestratorResult): RoutingLayer {
  if (result.delegation) return "L2";
  if (result.routing_info.tool_used === "web_search") return "L1";
  return "L0";
}

// ── SSE Event（含 routing_layer Phase 2.0）───────────────────────────────────

export interface SSEEvent {
  type: "status" | "result" | "error" | "done" | "chunk" | "fast_reply";
  stream: string;
  /** Phase 2.0: 路由分层（L0/L1/L2/L3） */
  routing_layer?: RoutingLayer;
  /** Phase 1.5: Clarifying 事件可选字段 */
  options?: string[];
  question_id?: string;
}

/**
 * 轮询 TaskArchive，感知状态变化，推送 SSE 事件
 * 嵌入用户体验安抚消息（30s/60s/120s 节点）
 */
export async function* pollArchiveAndYield(
  taskId: string,
  lang: "zh" | "en"
): AsyncGenerator<SSEEvent> {
  // 自适应轮询间隔：任务初期频繁检查，后期降低频率
  // - < 10s：2s（快速感知完成）
  // - 10s ~ 60s：3s（正常等待）
  // - > 60s：5s（减少数据库压力）
  const getPollInterval = (elapsedMs: number): number => {
    if (elapsedMs < 10000) return 2000;
    if (elapsedMs < 60000) return 3000;
    return 5000;
  };

  const MESSAGES = {
    zh: {
      running30s: "🔄 任务比较复杂，正在深度分析...",
      running60s: "⏳ 资料已找到，正在整理对比...",
      running120s: "🔄 仍在执行，请继续等待...",
      done: "慢模型分析完成，结果如下：",
    },
    en: {
      running30s: "🔄 Task is complex, analyzing deeply...",
      running60s: "⏳ Data found, comparing results...",
      running120s: "🔄 Still running, please wait...",
      done: "Slow model analysis complete:",
    },
  };

  const msgs = MESSAGES[lang] ?? MESSAGES.zh;
  const startTime = Date.now();
  let lastStatusTime = startTime;

  while (true) {
    const task = await TaskArchiveRepo.getById(taskId);
    if (!task) break;

    const elapsed = Date.now() - startTime;

    // 安抚消息（用 elapsed < X+1000 而非 >= X，只发一次）
    if (task.status === "running" || task.status === "pending") {
      if (elapsed > 30000 && elapsed < 31000 && lastStatusTime < 30000) {
        yield { type: "status", stream: msgs.running30s, routing_layer: "L2" };
        lastStatusTime = Date.now();
      } else if (elapsed > 60000 && elapsed < 61000 && lastStatusTime < 60000) {
        yield { type: "status", stream: msgs.running60s, routing_layer: "L2" };
        lastStatusTime = Date.now();
      } else if (elapsed > 120000 && elapsed < 121000) {
        // 120s 后每 60s 发一次
        const sixtySecondMarker = Math.floor((elapsed - 120000) / 60000);
        if (elapsed < 120000 + 60000 * sixtySecondMarker + 1000 && elapsed >= 120000 + 60000 * sixtySecondMarker) {
          yield { type: "status", stream: msgs.running120s, routing_layer: "L2" };
          lastStatusTime = Date.now();
        }
      }
    }

    if (task.status === "done") {
      if (!task.delivered) {
        const execution = task.slow_execution ?? {};
        const workerResult = typeof execution.result === "string"
          ? execution.result
          : "";
        const workerConfidence = execution.confidence ?? 0.7;

        // Phase 3.0: 写入 worker_completed 事件到 DB
        try {
          const { TaskArchiveEventRepo } = await import("../db/task-archive-repo.js");
          await TaskArchiveEventRepo.create({
            archive_id: taskId,
            task_id: taskId,
            event_type: "worker_completed",
            payload: {
              worker_role: execution.worker_role ?? "slow_worker",
              summary: workerResult.substring(0, 200),
              confidence: workerConfidence,
            },
            actor: execution.worker_role ?? "slow_worker",
          });
        } catch (e: any) {
          console.warn("[pollArchiveAndYield] worker_completed event write failed:", e.message);
        }

        // Phase 3.0: 先推送 worker_completed SSE 事件
        yield {
          type: "worker_completed",
          task_id: taskId,
          command_id: taskId,
          worker_type: execution.worker_role as any ?? "slow_worker",
          summary: workerResult.substring(0, 200),
          routing_layer: "L2",
        };

        // Phase 3.0: Manager Synthesis — Manager 读取 Worker 结果，合成最终输出
        let synthesizedContent = workerResult;
        try {
          const synthesized = await synthesizeManagerOutput(taskId, workerResult, workerConfidence, lang);
          if (synthesized) {
            synthesizedContent = synthesized;
            // 写入 manager_synthesized 事件
            const { TaskArchiveEventRepo: EventRepo } = await import("../db/task-archive-repo.js");
            await EventRepo.create({
              archive_id: taskId,
              task_id: taskId,
              event_type: "manager_synthesized",
              payload: {
                final_content_length: synthesized.length,
                confidence: workerConfidence,
              },
              actor: "fast_manager",
            });
            // 推送 manager_synthesized SSE 事件
            yield {
              type: "manager_synthesized",
              task_id: taskId,
              final_content: synthesized,
              confidence: workerConfidence,
              routing_layer: "L2",
            };
          }
        } catch (e: any) {
          console.warn("[pollArchiveAndYield] Manager synthesis failed, using raw result:", e.message);
        }

        // Phase 3.0: 推送 result 文本事件
        yield {
          type: "result",
          stream: `${msgs.done}\n\n${synthesizedContent}`,
          routing_layer: "L2",
        };
        await TaskArchiveRepo.markDelivered(taskId).catch(() => {});
      }
      break;
    }

    if (task.status === "failed") {
      const errors = task.slow_execution?.errors ?? [];
      yield { type: "error", stream: `任务执行失败: ${errors[0] ?? "Unknown error"}`, routing_layer: "L2" };
      break;
    }

    const interval = getPollInterval(Date.now() - startTime);
    await sleep(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 查询委托结果（供轮询接口使用）──────────────────────────────────────────────

export interface DelegationResult {
  task_id: string;
  status: "pending" | "completed" | "failed";
  slow_result?: string;
  fast_reply?: string;
  error?: string;
}

export async function getDelegationResult(taskId: string): Promise<DelegationResult | null> {
  try {
    const task = await TaskRepo.getById(taskId);
    if (!task) return null;

    const traces = await TaskRepo.getTraces(taskId);
    const delegatedTrace = traces.find((t) => (t.type as string) === "llm_native_delegated");
    const failedTrace = traces.find((t) => (t.type as string) === "llm_native_delegation_failed");

    if (failedTrace) {
      return { task_id: taskId, status: "failed", error: (failedTrace.detail as any)?.error || "Unknown error" };
    }
    if (delegatedTrace) {
      const detail = delegatedTrace.detail as any;
      return { task_id: taskId, status: "completed", slow_result: detail?.slow_result };
    }
    return { task_id: taskId, status: "pending" };
  } catch (e: any) {
    console.error("[orchestrator] getDelegationResult failed:", e.message);
    return null;
  }
}

// ── Routing Evaluation（供 Benchmark 使用）──────────────────────────────────────

export interface RoutingEvaluation {
  routing_intent: string;    // 路由意图: chat/knowledge/research/analysis/code/creative
  selected_role: "fast" | "slow";
  tool_used?: string;       // 如 "web_search"
  fast_reply: string;       // Fast 模型的直接回复
  confidence: number;       // 0-1 置信度
  /** Phase 2.0: 路由分层（L0/L1/L2） */
  routing_layer: RoutingLayer;
}

const EVAL_SYSTEM_PROMPT_ZH = `你是一个严格的路由分类器。
给定用户输入，你需要输出一个 JSON 对象（不含 markdown）：

{
  "routing_intent": "chat|knowledge|research|analysis|code|creative|other",
  "selected_role": "fast|slow",
  "tool_used": "web_search|null",
  "fast_reply": "直接回复内容（1-2句话）",
  "confidence": 0.0-1.0
}

分类规则：
- routing_intent:
  * chat: 闲聊、问候、感谢、简单问答
  * knowledge: 需要查实时信息（天气/新闻/股价/比赛结果）
  * research: 需要深度分析、多角度对比、调研报告
  * analysis: 数据分析、因果推理、多步骤计算
  * code: 代码生成、bug修复、技术问题
  * creative: 写作、创意、内容生成
  * other: 不属于以上类别
- selected_role: fast=快模型直接回答, slow=需要慢模型深度处理
- tool_used: 如需查实时数据填 "web_search"，否则 null
- fast_reply: 如果 selected_role=fast，给出简短回复；如果是 slow，给出确认语如"让我深入分析一下这个问题"
- confidence: 你对这个分类的置信度

只输出 JSON，不要解释。`;

const EVAL_SYSTEM_PROMPT_EN = `You are a strict routing classifier.
Given the user input, output a JSON object (no markdown):

{
  "routing_intent": "chat|knowledge|research|analysis|code|creative|other",
  "selected_role": "fast|slow",
  "tool_used": "web_search|null",
  "fast_reply": "direct reply (1-2 sentences)",
  "confidence": 0.0-1.0
}

Classification rules:
- routing_intent:
  * chat: casual talk, greetings, thanks, simple Q&A
  * knowledge: needs real-time info (weather/news/stocks/results)
  * research: deep analysis, multi-perspective comparison, investigation
  * analysis: data analysis, causal reasoning, multi-step computation
  * code: code generation, bug fixes, technical questions
  * creative: writing, creative content
  * other: doesn't fit above
- selected_role: fast=direct answer, slow=deep processing needed
- tool_used: "web_search" if real-time data needed, else null
- fast_reply: short reply if fast, confirmation if slow
- confidence: 0.0-1.0

Output only JSON, no explanation.`;

/**
 * 路由评估函数（供 Benchmark runner 调用）
 * 独立于 orchestrator 主流程，专注返回结构化路由决策
 */
export async function evaluateRouting(
  message: string,
  language: "zh" | "en" = "zh",
  reqApiKey?: string
): Promise<RoutingEvaluation> {
  const systemPrompt = language === "zh" ? EVAL_SYSTEM_PROMPT_ZH : EVAL_SYSTEM_PROMPT_EN;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  let raw = "";
  try {
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(config.fastModel, messages, reqApiKey, config.openaiBaseUrl || undefined);
      raw = resp.content;
    } else {
      const resp = await callModelFull(config.fastModel, messages);
      raw = resp.content;
    }
  } catch (e: any) {
    console.error("[evaluateRouting] LLM call failed:", e.message);
    return {
      routing_intent: "other",
      selected_role: "fast" as const,
      fast_reply: language === "zh" ? "（路由评估失败，使用默认）" : "(Routing eval failed, using default)",
      confidence: 0,
      routing_layer: "L0" as RoutingLayer,
    };
  }

  // 解析 JSON
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const role: "fast" | "slow" = parsed.selected_role === "slow" ? "slow" : "fast";
      const toolUsed: string | undefined = parsed.tool_used === "web_search" ? "web_search" : undefined;
      const layer: RoutingLayer = role === "slow" ? "L2" : toolUsed ? "L1" : "L0";
      return {
        routing_intent: parsed.routing_intent ?? "other",
        selected_role: role,
        tool_used: toolUsed,
        fast_reply: parsed.fast_reply ?? "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        routing_layer: layer,
      };
    }
  } catch {
    // fall through to default
  }

  // 解析失败，使用默认值
  return {
    routing_intent: "other",
    selected_role: "fast",
    fast_reply: raw.slice(0, 200),
    confidence: 0,
    routing_layer: "L0" as RoutingLayer,
  };
}
