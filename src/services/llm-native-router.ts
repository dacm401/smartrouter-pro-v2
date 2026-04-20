// Phase 3.0: LLM-Native Router — ManagerDecision 驱动的路由
// backend/src/services/llm-native-router.ts
//
// 职责：
// 1. 调用 Fast 模型生成 ManagerDecision JSON
// 2. 用 parseAndValidate() 校验
// 3. 按 decision_type 路由：direct_answer / ask_clarification / delegate_to_slow / execute_task
//
// Phase 1：轻量接入，不改旧 orchestrator，双轨并行
//
// Phase 4.1 增强：Permission Layer 预留点
// Phase 4.2 增强：Redaction Engine 集成
// - 在数据暴露给云端模型之前，根据 fallbackAction 执行脱敏
// - 使用 config.permission.redaction feature flag 控制

import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { callModelFull, callOpenAIWithOptions } from "../models/model-gateway.js";
import type { ChatMessage } from "../types/index.js";
import type {
  ManagerDecision,
  ManagerDecisionType,
  RoutingLayer,
  DirectResponse,
  ClarifyQuestion,
  CommandPayload,
  ExecutionPlan,
} from "../types/index.js";
import { parseAndValidate } from "../orchestrator/decision-validator.js";
import { taskPlanner } from "./task-planner.js";

// Phase 4: Permission Layer + Redaction imports (lazy loaded to avoid circular deps)
let phase4Module: typeof import("./phase4/index.js") | null = null;

async function getPhase4() {
  if (!phase4Module) {
    phase4Module = await import("./phase4/index.js");
  }
  return phase4Module;
}

// ── Manager Prompt ────────────────────────────────────────────────────────────

function buildManagerSystemPrompt(lang: "zh" | "en"): string {
  // 中文版 prompt
  const zhPrompt = `你是 SmartRouter Pro 的 Manager（管理模型）。

理解用户请求后，决定最优处理路径，严格按以下 JSON Schema 输出。

【四种决策类型 — 必须严格使用以下 JSON 格式】

1. direct_answer（直接回答）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "direct_answer",
  "direct_response": { "content": "你的回复内容" },
  "reason": "为什么直接回答",
  "confidence": 1.0
}

2. ask_clarification（请求澄清）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "ask_clarification",
  "clarification": { "question_text": "你的问题", "options": [{ "label": "选项A" }] },
  "reason": "为什么需要澄清",
  "confidence": 1.0
}

3. delegate_to_slow（委托慢模型）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "delegate_to_slow",
  "command": { "task_brief": "压缩后的任务摘要", "constraints": ["约束1"] },
  "reason": "为什么委托慢模型",
  "confidence": 1.0
}

4. execute_task（执行任务）
{
  "schema_version": "manager_decision_v1",
  "decision_type": "execute_task",
  "command": { "goal": "任务目标描述" },
  "reason": "为什么需要执行任务",
  "confidence": 1.0
}

【决策原则】
- direct_answer: 闲聊/打招呼/情绪表达/简单问答，不需要外部数据
- ask_clarification: 请求模糊、缺少关键信息（目标/范围/格式不明确）
- delegate_to_slow: 深度分析/多步推理/复杂推理/知识截止日期外的内容
- execute_task: 需要工具调用/代码执行/搜索/多步操作
- 能直接答就不委托，委托时 task_brief 压缩到最小必要信息

【输出规则】
- 只输出 JSON 对象，不输出其他文字
- JSON 用代码块包裹：\`\`\`json ... \`\`\`
- 必须包含 schema_version / decision_type / reason / confidence`;

  // 英文版 prompt
  const enPrompt = `You are SmartRouter Pro's Manager model.

Understand the user's request, decide the optimal next step, and output strictly following the JSON Schema below.

【Four Decision Types — EXACT JSON format required】

1. direct_answer
{
  "schema_version": "manager_decision_v1",
  "decision_type": "direct_answer",
  "direct_response": { "content": "Your reply content" },
  "reason": "Why direct answer",
  "confidence": 1.0
}

2. ask_clarification
{
  "schema_version": "manager_decision_v1",
  "decision_type": "ask_clarification",
  "clarification": { "question_text": "Your question here", "options": [{ "label": "Option A" }] },
  "reason": "Why clarification is needed",
  "confidence": 1.0
}

3. delegate_to_slow
{
  "schema_version": "manager_decision_v1",
  "decision_type": "delegate_to_slow",
  "command": { "task_brief": "Compressed task summary", "constraints": ["constraint1"] },
  "reason": "Why delegate to slow model",
  "confidence": 1.0
}

4. execute_task
{
  "schema_version": "manager_decision_v1",
  "decision_type": "execute_task",
  "command": { "goal": "Task goal description" },
  "reason": "Why execute task",
  "confidence": 1.0
}

【Decision Rules】
- direct_answer: chat/greeting/emotional/simple Q&A, no external data needed
- ask_clarification: ambiguous request, missing key info (goal/scope/format unclear)
- delegate_to_slow: deep analysis/multi-step reasoning/complex reasoning/knowledge cutoff exceeded
- execute_task: requires tool calling/code execution/search/multi-step operations
- Prefer direct_answer when possible; compress task_brief to minimum when delegating

【Output Rules】
- Output JSON ONLY, no other text
- Wrap JSON in code block: \`\`\`json ... \`\`\`
- Must include: schema_version / decision_type / reason / confidence`;

  return lang === "zh" ? zhPrompt : enPrompt;
}

// ── 入参 ─────────────────────────────────────────────────────────────────────

export interface LLMNativeRouterInput {
  message: string;
  user_id: string;
  session_id: string;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
}

export interface LLMNativeRouterResult {
  /** 最终返回给用户的文本 */
  message: string;
  /** ManagerDecision（供 SSE 推送） */
  decision: ManagerDecision | null;
  /** 委托信息（有委托时返回 task_id） */
  delegation?: { task_id: string; status: "triggered" };
  /** 澄清问题（有澄清请求时返回） */
  clarifying?: ClarifyQuestion;
  /** 路由层 */
  routing_layer: RoutingLayer;
  /** 决策类型 */
  decision_type: ManagerDecisionType | null;
  /** Manager JSON 原始文本（调试用） */
  raw_manager_output?: string;
  /** execute_task 的执行计划（Phase 2 新增） */
  execution_plan?: ExecutionPlan;
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

export async function routeWithManagerDecision(
  input: LLMNativeRouterInput
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, history, language, reqApiKey } = input;

  // Step 1: 调用 Fast 模型，传递 Manager Prompt
  const managerOutput = await callManagerModel({ message, history, language, reqApiKey });

  // Step 2: 解析 JSON（Phase 0 使用正则解析）
  const decision = parseAndValidate(managerOutput);

  // Step 3: 不合法 → fallback，返回 L0 direct_answer
  if (!decision) {
    console.warn("[llm-native-router] ManagerDecision parse failed, fallback to direct_answer");
    return {
      message: managerOutput.trim() || (language === "zh" ? "好的，让我看看。" : "Got it, let me check."),
      decision: null,
      routing_layer: "L0",
      decision_type: null,
      raw_manager_output: managerOutput,
    };
  }

  // Step 4: 按 decision_type 路由
  return routeByDecision(decision, { message, user_id, session_id, language, reqApiKey, raw: managerOutput });
}

// ── Fast Manager 调用 ─────────────────────────────────────────────────────────

async function callManagerModel(input: {
  message: string;
  history: ChatMessage[];
  language: "zh" | "en";
  reqApiKey?: string;
}): Promise<string> {
  const { message, history, language, reqApiKey } = input;

  const systemPrompt = buildManagerSystemPrompt(language);
  // 保留最近 6 轮对话作为上下文，不传全量 history（Manager 只读当前任务）
  const recentHistory = history.filter((m) => m.role !== "system").slice(-6);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    { role: "user", content: message },
  ];

  try {
    if (reqApiKey) {
      const resp = await callOpenAIWithOptions(
        config.fastModel,
        messages,
        reqApiKey,
        config.openaiBaseUrl || undefined
      );
      return resp.content;
    }
    const resp = await callModelFull(config.fastModel, messages);
    return resp.content;
  } catch (e: any) {
    console.error("[llm-native-router] Manager model call failed:", e.message);
    throw e;
  }
}

// ── 决策路由 ─────────────────────────────────────────────────────────────────

interface RouteContext {
  message: string;
  user_id: string;
  session_id: string;
  language: "zh" | "en";
  reqApiKey?: string;
  raw: string;
}

async function routeByDecision(
  decision: ManagerDecision,
  ctx: RouteContext
): Promise<LLMNativeRouterResult> {
  const { message, user_id, session_id, language, reqApiKey, raw } = ctx;

  switch (decision.decision_type) {
    case "direct_answer": {
      const dr = decision.direct_response as DirectResponse | undefined;
      const reply = dr?.content ?? (language === "zh" ? "好的。" : "Got it.");
      return {
        message: reply,
        decision,
        routing_layer: "L0",
        decision_type: "direct_answer",
        raw_manager_output: raw,
      };
    }

    case "ask_clarification": {
      const cq = decision.clarification as ClarifyQuestion | undefined;
      const questionText = cq?.question_text ?? (language === "zh" ? "能再具体一点吗？" : "Could you be more specific?");
      const clarifyingMessage = cq?.options?.length
        ? `${questionText} ${cq.options.map((o) => `"${o.label}"`).join(" / ")}`
        : questionText;

      // B39-02 fix: ask_clarification 写 task_archives，便于追踪 ClarifyQuestion 后续状态
      const clarifyingTaskId = uuid();
      try {
        const { TaskArchiveRepo } = await import("../db/task-archive-repo.js");
        await TaskArchiveRepo.create({
          task_id: clarifyingTaskId,
          user_id,
          session_id,
          decision,
          user_input: message,
        });
        // create 默认 state=delegated，改为 clarifying 以便追踪
        await TaskArchiveRepo.updateState(clarifyingTaskId, "clarifying");
      } catch (e: any) {
        console.warn("[llm-native-router] Clarifying archive create failed:", e.message);
      }

      return {
        message: clarifyingMessage,
        decision,
        routing_layer: "L0",
        decision_type: "ask_clarification",
        clarifying: cq,
        clarifying_task_id: clarifyingTaskId,
        raw_manager_output: raw,
      };
    }

    case "delegate_to_slow": {
      const command = decision.command as CommandPayload | undefined;
      const taskId = uuid();
      let processedCommand = command;

      // Phase 4.1 + 4.2: Permission Layer + Redaction Engine
      // 目的：在数据暴露给云端模型之前，检查是否允许暴露，必要时执行脱敏
      if (config.permission.enabled) {
        try {
          const pl = await getPhase4();
          // 构建分类上下文：task_brief 是暴露给云端的核心数据
          const classificationCtx = {
            dataType: "task_archive" as const,
            sensitivity: "internal" as const,
            source: "system" as const,
            hasPII: false,
            ageHours: 0,
          };
          const classification = pl.DataClassifier.classify(command?.task_brief ?? "", classificationCtx);
          const permissionCtx = {
            sessionId: session_id,
            userId: user_id,
            requestedTier: classification.classification,
            featureFlags: {
              use_permission_layer: config.permission.enabled,
              use_data_classification: config.permission.dataClassification,
              use_redaction: config.permission.redaction,
            },
            userDataPreferences: config.permission.userDataPreferences,
            targetModel: "cloud_72b" as const,
          };
          const permission = pl.PermissionChecker.fromClassification(classification.classification, permissionCtx);

          console.log("[llm-native-router] Phase 4 Permission Check:", {
            taskId,
            dataType: "task_brief",
            classification: classification.classification,
            permissionAllowed: permission.allowed,
            fallbackAction: permission.fallbackAction,
          });

          // Phase 4.2: 根据 fallbackAction 执行脱敏
          if (permission.fallbackAction === "redact" && config.permission.redaction) {
            const redactionEngine = pl.getRedactionEngine();
            const redactionCtx = {
              sessionId: session_id,
              userId: user_id,
              dataType: "task_archive" as const,
              targetClassification: classification.classification,
              enableAudit: true,
            };

            if (command) {
              const redactedBrief = redactionEngine.redact(command.task_brief ?? "", redactionCtx);
              const redactedWorkerHint = redactionEngine.redact(command.worker_hint ?? "", redactionCtx);

              processedCommand = {
                ...command,
                task_brief: redactedBrief.content as string,
                worker_hint: redactedWorkerHint.content as string,
              };

              console.log("[llm-native-router] Phase 4.2 Redaction Applied:", {
                taskId,
                briefStats: redactedBrief.stats,
                workerHintStats: redactedWorkerHint.stats,
              });
            }
          } else if (permission.fallbackAction === "reject" || !permission.allowed) {
            // 拒绝暴露，回退到 direct_answer
            return {
              message: language === "zh"
                ? "抱歉，这个问题涉及敏感信息，无法交给更专业的模型处理。"
                : "Sorry, this request involves sensitive information and cannot be processed by the cloud model.",
              decision,
              routing_layer: "L0",
              decision_type: "direct_answer",
              raw_manager_output: raw,
            };
          }
        } catch (e: any) {
          console.warn("[llm-native-router] Permission layer check failed:", e.message);
        }
      }

      // Phase 3.0: 写入 TaskArchive
      try {
        const { TaskArchiveRepo } = await import("../db/task-archive-repo.js");
        await TaskArchiveRepo.create({
          task_id: taskId,
          user_id,
          session_id,
          decision,
          user_input: message,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskArchive create failed:", e.message);
      }

      // Phase 3.0: 写入 task_commands（使用脱敏后的 processedCommand）
      try {
        const { TaskCommandRepo } = await import("../db/task-archive-repo.js");
        if (processedCommand) {
          await TaskCommandRepo.create({
            task_id: taskId,
            archive_id: taskId,
            user_id,
            command_type: processedCommand.command_type,
            worker_hint: processedCommand.worker_hint,
            priority: processedCommand.priority ?? "normal",
            payload: processedCommand,
          });
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskCommand create failed:", e.message);
      }

      const fastReply = language === "zh"
        ? "这个问题比较深，我正在请更专业的模型帮你分析，稍等一下～"
        : "This is complex. I'm getting a more specialized model to analyze it, please wait...";

      return {
        message: fastReply,
        decision,
        delegation: { task_id: taskId, status: "triggered" },
        routing_layer: "L2",
        decision_type: "delegate_to_slow",
        raw_manager_output: raw,
      };
    }

    case "execute_task": {
      const command = decision.command as CommandPayload | undefined;
      const taskId = uuid();
      let processedCommand = command;

      // Phase 4.1 + 4.2: Permission Layer + Redaction Engine
      if (config.permission.enabled) {
        try {
          const pl = await getPhase4();
          const classificationCtx = {
            dataType: "task_archive" as const,
            sensitivity: "internal" as const,
            source: "system" as const,
            hasPII: false,
            ageHours: 0,
          };
          const classification = pl.DataClassifier.classify(command?.task_brief ?? "", classificationCtx);
          const permissionCtx = {
            sessionId: session_id,
            userId: user_id,
            requestedTier: classification.classification,
            featureFlags: {
              use_permission_layer: config.permission.enabled,
              use_data_classification: config.permission.dataClassification,
              use_redaction: config.permission.redaction,
            },
            userDataPreferences: config.permission.userDataPreferences,
            targetModel: "cloud_72b" as const,
          };
          const permission = pl.PermissionChecker.fromClassification(classification.classification, permissionCtx);

          console.log("[llm-native-router] Phase 4 Permission Check (execute_task):", {
            taskId,
            dataType: "task_brief",
            classification: classification.classification,
            permissionAllowed: permission.allowed,
            fallbackAction: permission.fallbackAction,
          });

          // Phase 4.2: 根据 fallbackAction 执行脱敏
          if (permission.fallbackAction === "redact" && config.permission.redaction) {
            const redactionEngine = pl.getRedactionEngine();
            const redactionCtx = {
              sessionId: session_id,
              userId: user_id,
              dataType: "task_archive" as const,
              targetClassification: classification.classification,
              enableAudit: true,
            };

            if (command) {
              const redactedBrief = redactionEngine.redact(command.task_brief ?? "", redactionCtx);
              const redactedWorkerHint = redactionEngine.redact(command.worker_hint ?? "", redactionCtx);

              processedCommand = {
                ...command,
                task_brief: redactedBrief.content as string,
                worker_hint: redactedWorkerHint.content as string,
              };

              console.log("[llm-native-router] Phase 4.2 Redaction Applied (execute_task):", {
                taskId,
                briefStats: redactedBrief.stats,
              });
            }
          }
        } catch (e: any) {
          console.warn("[llm-native-router] Permission layer check failed:", e.message);
        }
      }

      // Step 1: 写入 TaskArchive（state: delegated，Worker 会改为 running）
      try {
        const { TaskArchiveRepo } = await import("../db/task-archive-repo.js");
        await TaskArchiveRepo.create({
          task_id: taskId,
          user_id,
          session_id,
          decision,
          user_input: message,
          task_brief: command?.task_brief,
          goal: command?.goal,
        });
      } catch (e: any) {
        console.warn("[llm-native-router] TaskArchive create failed:", e.message);
      }

      // Step 2: 写入 task_commands（使用脱敏后的 processedCommand）
      try {
        const { TaskCommandRepo } = await import("../db/task-archive-repo.js");
        if (processedCommand) {
          await TaskCommandRepo.create({
            task_id: taskId,
            archive_id: taskId,
            user_id,
            command_type: processedCommand.command_type ?? "execute_plan",
            worker_hint: processedCommand.worker_hint ?? "execute_worker",
            priority: processedCommand.priority ?? "normal",
            payload: processedCommand,
            timeout_sec: processedCommand.timeout_sec,
          });
        }
      } catch (e: any) {
        console.warn("[llm-native-router] TaskCommand create failed:", e.message);
      }

      const fastReply = language === "zh"
        ? "好的，正在处理这个任务，稍等一下～"
        : "Got it. Processing this task, please wait...";

      return {
        message: fastReply,
        decision,
        delegation: { task_id: taskId, status: "triggered" },
        routing_layer: "L3",
        decision_type: "execute_task",
        raw_manager_output: raw,
      };
    }

    default: {
      console.warn("[llm-native-router] Unknown decision_type:", (decision as any).decision_type);
      return {
        message: language === "zh" ? "好的，让我看看。" : "Got it.",
        decision,
        routing_layer: "L0",
        decision_type: null,
        raw_manager_output: raw,
      };
    }
  }
}
