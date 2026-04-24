import { Hono } from "hono";
import { stream } from "hono/streaming";
import { v4 as uuid } from "uuid";
import type { ChatRequest, ChatResponse, DecisionRecord, ExecutionStepsSummary, FeedbackType, TaskSummary } from "../types/index.js";

const VALID_FEEDBACK_TYPES: readonly FeedbackType[] = [
  "accepted", "regenerated", "edited",
  "thumbs_up", "thumbs_down",
  "follow_up_doubt", "follow_up_thanks",
] as const;
import { manageContext } from "../services/context-manager.js";
import { callModelFull, callModelStream } from "../models/model-gateway.js";
import { callOpenAIWithOptions } from "../models/providers/openai.js";
import { checkQuality } from "../router/quality-gate.js";
import { analyzeAndRoute, getDefaultRouting } from "../router/router.js";
import { logDecision } from "../logging/decision-logger.js";
import { learnFromInteraction } from "../features/learning-engine.js";
import { estimateCost } from "../models/token-counter.js";
import { config } from "../config.js";
import { TaskRepo } from "../db/repositories.js";
import type { ChatMessage } from "../types/index.js";
import { assemblePrompt } from "../services/prompt-assembler.js";
import type { PromptMode } from "../services/prompt-assembler.js";
import { MemoryEntryRepo, ExecutionResultRepo } from "../db/repositories.js";
import { runRetrievalPipeline, buildCategoryAwareMemoryText } from "../services/memory-retrieval.js";
import { formatExecutionResultsForPlanner } from "../services/execution-result-formatter.js";
// EL-003: Execution Loop
import { taskPlanner } from "../services/task-planner.js";
import { executionLoop } from "../services/execution-loop.js";
// C3a: unified identity
import { getContextUserId } from "../middleware/identity.js";
// SSE 流式轮询（从 orchestrator.ts 迁移出来）
import { pollArchiveAndYield } from "../services/phase3/sse-poller.js";
// Phase 3.0: LLM-Native Router — ManagerDecision 驱动的路由
import { routeWithManagerDecision } from "../services/llm-native-router.js";
// O-007: 安抚功能 — 检测 pending 任务
import { DelegationArchiveRepo } from "../db/repositories.js";

const chatRouter = new Hono();

/** 调用模型：若请求携带 api_key 则用请求级 client，否则走默认 provider */
async function callModel(
  model: string,
  messages: ChatMessage[],
  reqApiKey?: string
) {
  if (reqApiKey) {
    return callOpenAIWithOptions(model, messages, reqApiKey, config.openaiBaseUrl || undefined);
  }
  return callModelFull(model, messages);
}

chatRouter.post("/chat", async (c) => {
  // UTF-8 fix: use c.req.raw.text() instead of c.req.json()
  // c.req.json() in @hono/node-server can mis-decode UTF-8 body as Latin-1
  const rawBody = await c.req.raw.text();
  let body: ChatRequest;
  try {
    body = JSON.parse(rawBody) as ChatRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const startTime = Date.now();

  // C3a: Priority 1 — middleware context (trusted X-User-Id header)
  // C3a: Priority 2 — dev-only body shim (only when allowDevFallback=true and no context)
  // C3a: read from middleware context via c.get() (not direct property — Hono uses private Map)
  const middlewareUserId = getContextUserId(c);
  // Dev fallback: if middleware couldn't extract (shouldn't happen with correct header)
  const userId = middlewareUserId || body.user_id || "default-user";

  const sessionId = body.session_id || uuid();

  // ── T1: Task Resume v1 (方案 C — 混合) ─────────────────────────────────────
  // Priority 1: explicit task_id in request body
  // Priority 2: find active task by session_id (no terminal status)
  // Priority 3: no resumable task → will create new task below
  let resumedTaskId: string | null = null;
  let resumedTaskSummary: TaskSummary | null = null;

  if (body.task_id) {
    const existingTask = await TaskRepo.getById(body.task_id as string);
    if (!existingTask) {
      return c.json({ error: `Task not found: ${body.task_id}` }, 404);
    }
    if (existingTask.user_id !== userId) {
      return c.json({ error: "Forbidden: task does not belong to this user" }, 403);
    }
    // Only resume if task is not already terminal
    if (!["completed", "failed", "cancelled"].includes(existingTask.status)) {
      resumedTaskId = existingTask.task_id;
      resumedTaskSummary = await TaskRepo.getSummary(existingTask.task_id);
      // Re-activate task status
      await TaskRepo.setStatus(resumedTaskId, "responding").catch((e) => console.warn("[chat] Failed to set task status to responding:", e));
    }
  } else if (body.session_id) {
    // T1: implicit resumption — find most recent active task for this session
    const activeTask = await TaskRepo.findActiveBySession(body.session_id as string, userId);
    if (activeTask) {
      resumedTaskId = activeTask.task_id;
      resumedTaskSummary = await TaskRepo.getSummary(activeTask.task_id);
      await TaskRepo.setStatus(resumedTaskId, "responding").catch((e) => console.warn("[chat] Failed to set task status to responding:", e));
    }
  }

  // 请求级覆盖：前端设置里的 Key / 模型优先于环境变量
  const reqApiKey = body.api_key || undefined;
  const effectiveFastModel = body.fast_model || config.fastModel;
  const effectiveSlowModel = body.slow_model || config.slowModel;

  try {
    const { features } = await analyzeAndRoute(
      { ...body, user_id: userId, session_id: sessionId }
    );
    // LLM-native routing: routing done by orchestrator, analyzeAndRoute returns empty routing
    const routing: import("../types/index.js").RoutingDecision = getDefaultRouting();

    // ── Phase 3.0: LLM-Native Manager-Worker 路由（默认路径）─────────────────────
    // 所有非 execute 请求默认走 LLM-Native 路由
    // LLM-Native 通过 routeWithManagerDecision → Manager 模型决策 → 四路分发
    if (body.use_llm_native_routing === true) {

      // ── SSE 流式分支：use_llm_native_routing=true + stream=true ────────────────
      // 流程：Manager 决策 → 立即推送安抚消息 → pollArchiveAndYield 推送 Worker 结果
      if (body.stream === true) {
        let llmNativeResult;
        try {
          llmNativeResult = await routeWithManagerDecision({
            message: body.message ?? "",
            user_id: userId,
            session_id: sessionId,
            turn_id: (body.history ?? []).length,
            history: body.history ?? [],
            language: features.language as "zh" | "en",
            reqApiKey,
          });
        } catch (e: any) {
          console.warn("[stream-llm] routeWithManagerDecision failed:", e.message);
          return c.json({ error: "LLM-native routing failed: " + e.message }, 500);
        }

        if (!llmNativeResult) {
          return c.json({ error: "Manager returned null decision" }, 500);
        }

        const taskId = llmNativeResult.delegation?.task_id || uuid();
        const lang = features.language as "zh" | "en";

        // SSE headers
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");
        c.header("X-Accel-Buffering", "no");

        return stream(c, async (s) => {
          try {
            // Step 1: 立即推送 Manager 的安抚消息
            if (llmNativeResult.message) {
              await s.write(`data: ${JSON.stringify({
                type: "manager_decision",
                decision_type: llmNativeResult.decision_type,
                routing_layer: llmNativeResult.routing_layer,
                message: llmNativeResult.message,
              })}\n\n`);
            }

            // Step 2: Clarifying → 推送澄清问题
            if (llmNativeResult.clarifying) {
              await s.write(`data: ${JSON.stringify({
                type: "clarifying_needed",
                routing_layer: "L0",
                question_text: llmNativeResult.clarifying.question_text,
                options: llmNativeResult.clarifying.options,
                question_id: llmNativeResult.clarifying.question_id,
              })}\n\n`);
            }

            // Step 3: 有 delegation → 轮询 Worker 结果
            if (llmNativeResult.delegation) {
              // Phase 3.0: 推送 archive_written 事件（archive 创建完成后立即发）
              if (llmNativeResult.archive_id) {
                await s.write(`data: ${JSON.stringify({
                  type: "archive_written",
                  task_id: taskId,
                  archive_id: llmNativeResult.archive_id,
                  decision_type: llmNativeResult.decision_type ?? "delegate_to_slow",
                  routing_layer: llmNativeResult.routing_layer,
                  timestamp: new Date().toISOString(),
                })}\n\n`);
              }

              // Phase 3.0: 推送 worker_started 事件（Worker 拿到 command 后立即发）
              if (llmNativeResult.command_id) {
                await s.write(`data: ${JSON.stringify({
                  type: "worker_started",
                  task_id: taskId,
                  command_id: llmNativeResult.command_id,
                  worker_role: llmNativeResult.decision_type === "execute_task" ? "execute_worker" : "slow_worker",
                  routing_layer: llmNativeResult.routing_layer,
                  timestamp: new Date().toISOString(),
                })}\n\n`);
              }

              // 推送 command_issued 事件
              await s.write(`data: ${JSON.stringify({
                type: "command_issued",
                task_id: taskId,
                routing_layer: llmNativeResult.routing_layer,
              })}\n\n`);

            // pollArchiveAndYield 会推送 worker_progress / worker_completed / manager_synthesized
            // Archive E2E 修复：保留原始事件的所有字段，只覆盖 routing_layer
            // G4: delegation_log_id 传给 pollArchiveAndYield，用于异步回写 execution 结果
            for await (const event of pollArchiveAndYield(taskId, lang, llmNativeResult.delegation_log_id)) {
                const payload = {
                  ...event,
                  routing_layer: event.routing_layer ?? llmNativeResult.routing_layer,
                };
                await s.write(`data: ${JSON.stringify(payload)}\n\n`);
              }
            }

            // done: SSE1 双路统一 done 事件（Fast 直答 / delegation 均发送）
            await s.write(`data: ${JSON.stringify({
              type: "done",
              stream: llmNativeResult.delegation
                ? (lang === "zh" ? "分析完成" : "Analysis complete")
                : (lang === "zh" ? "已返回答案" : "Answer ready"),
              routing_layer: llmNativeResult.routing_layer,
              archive_id: llmNativeResult.archive_id,
              task_id: taskId,
            })}\n\n`);
          } catch (e: any) {
            console.warn("[stream-llm] SSE error:", e.message);
            await s.write(`data: ${JSON.stringify({ type: "error", stream: e.message })}\n\n`);
            // SSE1: SSE 失败也需要 done 事件，双路完整闭环
            await s.write(`data: ${JSON.stringify({ type: "done", stream: lang === "zh" ? "发生错误" : "Error occurred" })}\n\n`);
          }
        });
      }
      // ── End SSE 分支 ──────────────────────────────────────────────────────────

      // ── 普通 HTTP 分支 ─────────────────────────────────────────────────────────
      let llmNativeResult;
      try {
        llmNativeResult = await routeWithManagerDecision({
          message: body.message ?? "",
          user_id: userId,
          session_id: sessionId,
          turn_id: (body.history ?? []).length,
          history: body.history ?? [],
          language: features.language as "zh" | "en",
          reqApiKey,
        });
      } catch (e: any) {
        // Manager 模型调用失败 → fallback 到旧 orchestrator
        console.warn("[chat] llm-native-router failed, fallback to orchestrator:", e.message);
        llmNativeResult = null;
      }

      if (llmNativeResult) {
        // ✅ LLM-Native 路由成功 → 直接返回结果（见下方完整处理）
        const taskId = llmNativeResult.delegation?.task_id || uuid();

        // 记录 decision log（Phase 3.0 扩展）
        await logDecision({
          id: uuid(),
          user_id: userId,
          session_id: sessionId,
          timestamp: startTime,
          input_features: features,
          routing: {
            router_version: "llm_native_v1",
            scores: { fast: 1, slow: 0 },
            confidence: 1.0,
            selected_model: config.fastModel,
            selected_role: "fast",
            selection_reason: `llm_native(${llmNativeResult.decision?.decision_type ?? "unknown"})`,
            fallback_model: config.slowModel,
            routing_layer: llmNativeResult.routing_layer,
          },
          context: {
            original_tokens: 0,
            compressed_tokens: 0,
            compression_level: "L0",
            compression_ratio: 0,
            memory_items_retrieved: 0,
            final_messages: [],
            compression_details: [],
          },
          execution: {
            model_used: config.fastModel,
            input_tokens: 0,
            output_tokens: 0,
            total_cost_usd: 0,
            latency_ms: Date.now() - startTime,
            did_fallback: false,
            response_text: llmNativeResult.message ?? "",
          },
        }).catch((e) => console.warn("[chat] Failed to log llm-native decision:", e));

        const response: ChatResponse = {
          message: llmNativeResult.message ?? "",
          decision: {
            id: uuid(),
            user_id: userId,
            session_id: sessionId,
            timestamp: startTime,
            input_features: features,
            routing: {
              router_version: "llm_native_v1",
              scores: { fast: 1, slow: 0 },
              confidence: llmNativeResult.decision?.confidence ?? 1.0,
              selected_model: config.fastModel,
              selected_role: "fast",
              selection_reason: "llm_native_v1",
              fallback_model: config.slowModel,
              routing_layer: llmNativeResult.decision?.routing_layer ?? "L0",
            },
            context: {
              original_tokens: 0,
              compressed_tokens: 0,
              compression_level: "none",
              compression_ratio: 1.0,
            },
            execution: {
              model_used: config.fastModel,
              input_tokens: 0,
              output_tokens: 0,
              total_cost_usd: 0,
              latency_ms: Date.now() - startTime,
              did_fallback: false,
              response_text: llmNativeResult.message ?? "",
            },
          } as unknown as DecisionRecord,
          clarifying: llmNativeResult.decision?.decision_type === "ask_clarification" ? llmNativeResult.clarifying : undefined,
          task_id: taskId,
          delegation: llmNativeResult.delegation
            ? { task_id: llmNativeResult.delegation.task_id, status: "triggered" }
            : undefined,
        };

        return c.json(response);
      }
      // llmNativeResult === null（Manager 模型调用失败）→ 返回错误，不回退到旧路径
        throw new Error("LLM-native routing failed: Manager model returned null. " +
          "Set body.execute=true for execution mode or check model availability.");
    }
    // ── End Phase 3.0 LLM-Native 分支 ───────────────────────────────────────────

    // 注意：非 execute 请求已在 LLM-Native 分支 return，此处仅处理 execute 模式
    // ── EL-003: Execution mode ───────────────────────────────────────────────
    // Triggered when the client sets body.execute === true.
    // Routes the request through TaskPlanner + ExecutionLoop instead of
    // the single-call model path. Existing logic is entirely unchanged when
    // body.execute is absent or false.
    if (body.execute === true) {
      // T1: reuse resumed taskId if available, otherwise create new
      const taskId = resumedTaskId || uuid();
      const title = body.message.substring(0, 100);

      // Create task record (only if this is a new task, not a resumed one)
      if (!resumedTaskId) {
        await TaskRepo.create({
          id: taskId,
          user_id: userId,
          session_id: sessionId,
          title,
          mode: "execute",
          complexity: "medium",
          risk: "low",
          goal: title,
          status: "responding",
        }).catch((e) => console.warn("[chat] Failed to create execute task:", e));
      }

      // Memory retrieval for planner context (same pipeline as non-execute path)
      let memoryEntriesUsed: string[] = [];
      if (config.memory.enabled) {
        const mems = await MemoryEntryRepo.getTopForUser(
          userId,
          config.memory.maxEntriesToInject
        );
        memoryEntriesUsed = mems.map((m) => m.id);
      }

      // RR-003: Retrieve recent execution results for planner context
      let executionResultContext = "";
      if (config.executionResult.enabled) {
        try {
          const recentResults = await ExecutionResultRepo.listByUser(
            userId,
            config.executionResult.maxResults
          );
          const filtered = recentResults.filter((r) =>
            config.executionResult.allowedReasons.includes(r.reason ?? "")
          );
          executionResultContext = formatExecutionResultsForPlanner(
            filtered,
            config.executionResult.maxTokensPerResult * 4 // rough char budget (4 chars/token)
          );
        } catch (e) {
          console.warn("[chat] Failed to retrieve execution results for planning:", e);
        }
      }

      // Step 1: Planning — decompose goal into an ordered ExecutionPlan
      const plan = await taskPlanner.plan({
        taskId,
        goal: body.message,
        userId,
        sessionId,
        model: effectiveSlowModel,
        executionResultContext,
      });

      // Step 2: Execute — run the plan step by step
      const loopResult = await executionLoop.run(plan, {
        taskId,
        userId,
        sessionId,
        model: effectiveSlowModel,
        maxSteps: 10,
        maxToolCalls: 20,
      });

      // Log the planning trace (loop already wrote step traces)
      await TaskRepo.createTrace({
        id: uuid(),
        task_id: taskId,
        type: "planning",
        detail: {
          goal: body.message,
          model: effectiveSlowModel,
          plan_steps: plan.steps.map((s) => ({ id: s.id, title: s.title, type: s.type })),
          loop_reason: loopResult.reason,
          completed_steps: loopResult.completedSteps,
          tool_calls_executed: loopResult.toolCallsExecuted,
        },
      }).catch((e) => console.warn("[chat] Failed to write planning trace:", e));

      // Update task execution stats (use loop message count as proxy for tokens)
      await TaskRepo.updateExecution(
        taskId,
        loopResult.messages.length * 200, // rough token estimate for now
      ).catch((e) => console.warn("[chat] Failed to update task:", e));

      // ER-003: Persist execution result (fire-and-forget; don't block the response)
      // Only persist completed or gracefully-stopped runs; skip hard errors.
      const persistableReasons = ["completed", "step_cap", "tool_cap", "no_progress"];
      if (persistableReasons.includes(loopResult.reason)) {
        const executionStart = Date.now();
        const stepsSummary: ExecutionStepsSummary = {
          totalSteps: plan.steps.length,
          completedSteps: loopResult.completedSteps,
          toolCallsExecuted: loopResult.toolCallsExecuted,
          steps: plan.steps.map((s, i) => ({
            index: i,
            title: s.title,
            type: s.type,
            status: s.status as "pending" | "in_progress" | "completed" | "failed",
            tool_name: s.tool_name,
            error: s.error,
          })),
        };
        ExecutionResultRepo.save({
          task_id: taskId,
          user_id: userId,
          session_id: sessionId,
          final_content: loopResult.finalContent,
          steps_summary: stepsSummary,
          memory_entries_used: memoryEntriesUsed,
          model_used: effectiveSlowModel,
          tool_count: loopResult.toolCallsExecuted,
          duration_ms: Date.now() - executionStart,
          reason: loopResult.reason,
        }).catch((e) => console.warn("[chat] Failed to persist execution result:", e));
      }

      return c.json({ message: loopResult.finalContent, task_id: taskId });
    }
    // ── End EL-003 execution mode ────────────────────────────────────────────

    // 流式请求（非 execute）默认走 LLM-Native SSE 分支，已在 try 块顶部处理。
    // 旧 streaming 路径（依赖 orchestrator）已废弃删除。
    // 此处保留单次调用路径作为 legacy API fallback（body.execute && !body.use_llm_native_routing）

    // 创建任务记录（用 intent 作为 mode 推断：simple_qa/chat → direct，其他 → research）
    // T1: if we resumed an existing task, reuse its taskId instead of creating a new one
    const taskId = resumedTaskId || uuid();
    const message = body.message ?? "";
    const intentToMode: Record<string, string> = { simple_qa: "direct", chat: "direct", unknown: "direct" };
    const mode = intentToMode[features.intent] || "research";
    const complexityMap = ["low", "low", "medium", "high"];
    const complexity = complexityMap[Math.min(Math.floor(features.complexity_score / 33), 3)];
    const title = message.substring(0, 100);

    TaskRepo.create({
      id: taskId,
      user_id: userId,
      session_id: sessionId,
      title,
      mode,
      complexity,
      risk: "low",
      goal: title,
    }).catch((e) => console.warn("[chat] Failed to create task:", e));

    // 组装 prompt（Memory Injection MC-003 + MR-001 Retrieval Policy）
    const memories = config.memory.enabled
      ? await MemoryEntryRepo.getTopForUser(userId, config.memory.maxEntriesToInject)
      : [];

    // MR-001: v2 retrieval pipeline — only active when strategy === "v2"
    let retrievalResults: Array<{ entry: any; score: number; reason: string }> = [];
    if (config.memory.enabled && config.memory.retrieval.strategy === "v2") {
      const context = { userMessage: message };
      // Fetch a wider candidate pool (1.5× the injection limit) for scoring
      const candidates = await MemoryEntryRepo.getTopForUser(
        userId,
        Math.ceil(config.memory.maxEntriesToInject * 1.5)
      );
      retrievalResults = runRetrievalPipeline({
        entries: candidates,
        context,
        categoryPolicy: config.memory.retrieval.categoryPolicy,
        maxTotalEntries: config.memory.maxEntriesToInject,
      });

      // Fallback to v1 if v2 returns nothing
      if (retrievalResults.length === 0) {
        retrievalResults = memories.map((m) => ({
          entry: m,
          score: m.importance,
          reason: "v1-fallback(no-v2-results)",
        }));
      }
    } else {
      // Legacy v1 path: flat importance+recency ordering
      retrievalResults = memories.map((m) => ({
        entry: m,
        score: m.importance,
        reason: "v1",
      }));
    }

    // MR-002: category-aware memory text assembly
    // Replaces flat "[category] content" list with grouped sections by category
    // T1: Inject resumed task summary into context so the model knows the conversation history
    let taskSummary: { goal: string; summaryText: string; nextStep: string | null } | undefined;
    if (resumedTaskSummary) {
      const s = resumedTaskSummary;
      const parts: string[] = [];
      if (s.completed_steps?.length) parts.push(`已完成步骤:\n${s.completed_steps.join("\n")}`);
      if (s.blocked_by?.length) parts.push(`卡点: ${s.blocked_by.join(", ")}`);
      if (s.confirmed_facts?.length) parts.push(`已确认事实:\n${s.confirmed_facts.map((f: string) => `• ${f}`).join("\n")}`);
      if (s.summary_text) parts.push(`任务摘要: ${s.summary_text}`);
      taskSummary = {
        goal: s.goal || "继续任务",
        summaryText: parts.length > 0 ? parts.join("\n\n") : "(无详细摘要)",
        nextStep: s.next_step ?? null,
      };
    } else if (retrievalResults.length > 0) {
      taskSummary = {
        goal: "User memories:",
        summaryText: buildCategoryAwareMemoryText(retrievalResults as any).combined,
        nextStep: null,
      };
    }

    const promptAssembly = assemblePrompt({
      mode: mode as PromptMode,
      modelMode: routing.selected_role as "fast" | "slow",
      intent: features.intent,
      userMessage: message,
      memoryText: retrievalResults.length > 0 ? buildCategoryAwareMemoryText(retrievalResults as any).combined : undefined,
      taskSummary,
      maxTaskSummaryTokens: config.memory.maxEntriesToInject * config.memory.maxTokensPerEntry,
      lang: features.language as "zh" | "en",
    });

    const contextResult = await manageContext(
      { ...body, user_id: userId, session_id: sessionId },
      routing.selected_model,
      promptAssembly.systemPrompt
    );

    let modelResponse = await callModel(routing.selected_model, contextResult.final_messages, reqApiKey);
    let didFallback = false, fallbackReason: string | undefined;

    if (config.qualityGateEnabled && routing.selected_role === "fast") {
      const qualityCheck = checkQuality(modelResponse.content, features);
      if (!qualityCheck.passed && config.fallbackEnabled) {
        didFallback = true;
        fallbackReason = qualityCheck.issues.join("; ");
        modelResponse = await callModel(routing.fallback_model, contextResult.final_messages, reqApiKey);
      }
    }

    const latencyMs = Date.now() - startTime;
    const totalCost = estimateCost(modelResponse.input_tokens, modelResponse.output_tokens, modelResponse.model);

    const decision: DecisionRecord = {
      id: uuid(), user_id: userId, session_id: sessionId, timestamp: startTime, input_features: features, routing,
      context: contextResult,
      execution: {
        model_used: modelResponse.model,
        input_tokens: modelResponse.input_tokens,
        output_tokens: modelResponse.output_tokens,
        total_cost_usd: totalCost,
        latency_ms: latencyMs,
        did_fallback: didFallback,
        fallback_reason: fallbackReason,
        response_text: modelResponse.content,
      },
    };

    logDecision(decision).catch((e) => console.warn("[chat] Failed to log decision:", e));

    // P4: derive previousDecisionId from the last assistant message in history
    const previousDecisionId: string | undefined = (() => {
      for (let i = (body.history?.length ?? 0) - 1; i >= 0; i--) {
        const msg = body.history![i];
        if (msg.role === "assistant" && msg.decision_id) return msg.decision_id;
      }
      return undefined;
    })();

    // P4: userId is available in scope; pass to learnFromInteraction for feedback_events writes
    learnFromInteraction(decision, message, previousDecisionId, userId).catch((e) => console.warn("[chat] Learning failed:", e));
    // 更新任务执行统计
    TaskRepo.updateExecution(taskId, modelResponse.input_tokens + modelResponse.output_tokens).catch((e) => console.warn("[chat] Failed to update task:", e));

    // 写 trace：classification + response
    TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "classification",
      detail: { intent: features.intent, complexity_score: features.complexity_score, mode },
    }).catch((e) => console.warn("[chat] Failed to write classification trace:", e));
    TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "routing",
      detail: { selected_model: routing.selected_model, selected_role: routing.selected_role, confidence: routing.confidence, did_fallback: didFallback },
    }).catch((e) => console.warn("[chat] Failed to write routing trace:", e));
    TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "response",
      detail: { input_tokens: modelResponse.input_tokens, output_tokens: modelResponse.output_tokens, latency_ms: latencyMs, total_cost_usd: totalCost },
    }).catch((e) => console.warn("[chat] Failed to write response trace:", e));

    const response: ChatResponse = {
      message: modelResponse.content,
      decision: { ...decision, execution: { ...decision.execution, response_text: "" } },
      task_id: taskId,
    };
    return c.json(response);
  } catch (error: any) {
    console.error("Chat error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// 旧 /chat-result 端点已废弃（委托结果通过 LLM-Native SSE 实时推送，无需轮询）

chatRouter.post("/feedback", async (c) => {
  let decision_id: string;
  let feedback_type: string;
  let body: Record<string, unknown>;

  try {
    // UTF-8 fix: use c.req.raw.text() instead of c.req.json()
    const rawBody = await c.req.raw.text();
    body = JSON.parse(rawBody) as Record<string, unknown>;
    decision_id = body.decision_id as string;
    feedback_type = body.feedback_type as string;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!decision_id) return c.json({ error: "decision_id is required" }, 400);
  if (!feedback_type) return c.json({ error: "feedback_type is required" }, 400);

  // C3a: Priority 1 — middleware context (trusted X-User-Id header)
  // C3a: Priority 2 — dev-only body shim (only when allowDevFallback=true)
  let user_id = getContextUserId(c);

  // P2-1: Runtime type whitelist validation
  if (!VALID_FEEDBACK_TYPES.includes(feedback_type as FeedbackType)) {
    return c.json({ error: `invalid feedback_type '${feedback_type}'` }, 400);
  }

  // P2-2: Ownership validation
  const { query } = await import("../db/connection.js");
  const decision = await query(`SELECT id, user_id FROM decision_logs WHERE id=$1`, [decision_id]);
  if (decision.rowCount === 0) return c.json({ error: "decision not found" }, 404);
  if (decision.rows[0].user_id !== user_id) {
    return c.json({ error: "forbidden: decision does not belong to this user" }, 403);
  }

  const { recordFeedback } = await import("../features/feedback-collector.js");
  // P3: also write to feedback_events (userId confirmed via ownership check above)
  await recordFeedback(decision_id, feedback_type as FeedbackType, user_id);

  // S2: Fire-and-forget auto_learn on positive-signal feedback
  // Fetches the full decision record and passes it to autoLearnFromDecision
  // so memory_entries gets updated without blocking the feedback response.
  // M2: Also boost recent auto_learn memory relevance_score for this user.
  if (["thumbs_up", "accepted", "follow_up_thanks"].includes(feedback_type)) {
    // M2: Boost recent auto_learn entries (fire-and-forget)
    if (user_id) {
      const { MemoryEntryRepo } = await import("../db/repositories.js");
      MemoryEntryRepo.boostRecentAutoLearn(user_id, 300_000).catch((e) => console.warn("[feedback] boostRecentAutoLearn failed:", e));
    }
    const { autoLearnFromDecision } = await import("../services/memory-store.js");
    const { query: q2 } = await import("../db/connection.js");
    q2(`SELECT intent, selected_model, exec_input_tokens, exec_output_tokens FROM decision_logs WHERE id=$1`, [decision_id])
      .then(async (res) => {
        if (res.rows.length === 0 || !user_id) return;
        const row = res.rows[0];
        // Construct a minimal DecisionRecord sufficient for autoLearnFromDecision
        const minDecision: DecisionRecord = {
          id: decision_id,
          user_id: user_id!,
          session_id: "",
          timestamp: Date.now(),
          input_features: {
            raw_query: "",
            token_count: 0,
            intent: row.intent ?? "unknown",
            complexity_score: 50,
            has_code: false,
            has_math: false,
            requires_reasoning: false,
            conversation_depth: 0,
            context_token_count: 0,
            language: "zh",
          },
          routing: {
            router_version: "v1",
            scores: { fast: 0.5, slow: 0.5 },
            confidence: 0.8,
            selected_model: row.selected_model ?? "",
            selected_role: "fast",
            selection_reason: "",
            fallback_model: "",
          },
          context: {
            original_tokens: 0,
            compressed_tokens: 0,
            compression_level: "L0",
            compression_ratio: 1,
            memory_items_retrieved: 0,
            final_messages: [],
            compression_details: [],
          },
          execution: {
            model_used: row.selected_model ?? "",
            input_tokens: row.exec_input_tokens ?? 0,
            output_tokens: row.exec_output_tokens ?? 0,
            total_cost_usd: 0,
            latency_ms: 0,
            did_fallback: false,
            response_text: "",
          },
          feedback: {
            type: feedback_type as FeedbackType,
            score: 1,
            timestamp: Date.now(),
          },
        };
        await autoLearnFromDecision(user_id!, minDecision);
      })
      .catch((e) => console.warn("[feedback] autoLearnFromDecision failed:", e));
  }

  return c.json({ success: true });
});


export { chatRouter };
