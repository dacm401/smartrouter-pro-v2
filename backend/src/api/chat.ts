import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import type { ChatRequest, ChatResponse, DecisionRecord } from "../types/index.js";
import { analyzeAndRoute } from "../router/router.js";
import { manageContext } from "../context/context-manager.js";
import { callModelFull } from "../models/model-gateway.js";
import { callOpenAIWithOptions } from "../models/providers/openai.js";
import { checkQuality } from "../router/quality-gate.js";
import { logDecision } from "../observatory/decision-logger.js";
import { learnFromInteraction } from "../evolution/learning-engine.js";
import { estimateCost } from "../models/token-counter.js";
import { config } from "../config.js";
import { TaskRepo } from "../db/repositories.js";
import type { ChatMessage } from "../types/index.js";

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
  const body = await c.req.json<ChatRequest>();
  const startTime = Date.now();
  const userId = body.user_id || "default-user";
  const sessionId = body.session_id || uuid();

  // 请求级覆盖：前端设置里的 Key / 模型优先于环境变量
  const reqApiKey = body.api_key || undefined;
  const effectiveFastModel = body.fast_model || config.fastModel;
  const effectiveSlowModel = body.slow_model || config.slowModel;

  try {
    const { features, routing } = await analyzeAndRoute(
      { ...body, user_id: userId, session_id: sessionId }
    );

    // 如果请求级有指定模型，替换路由结果里的模型名
    if (body.fast_model || body.slow_model) {
      routing.selected_model = routing.selected_role === "fast" ? effectiveFastModel : effectiveSlowModel;
      routing.fallback_model = routing.selected_role === "fast" ? effectiveSlowModel : effectiveFastModel;
    }

    // 创建任务记录（用 intent 作为 mode 推断：simple_qa/chat → direct，其他 → research）
    const taskId = uuid();
    const intentToMode: Record<string, string> = { simple_qa: "direct", chat: "direct", unknown: "direct" };
    const mode = intentToMode[features.intent] || "research";
    const complexityMap = ["low", "low", "medium", "high"];
    const complexity = complexityMap[Math.min(Math.floor(features.complexity_score / 33), 3)];
    const title = body.message.substring(0, 100);

    TaskRepo.create({
      id: taskId,
      user_id: userId,
      session_id: sessionId,
      title,
      mode,
      complexity,
      risk: "low",
      goal: title,
    }).catch((e) => console.error("Failed to create task:", e));

    const contextResult = await manageContext(
      { ...body, user_id: userId, session_id: sessionId },
      routing.selected_model
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

    logDecision(decision).catch((e) => console.error("Failed to log decision:", e));
    learnFromInteraction(decision, body.message).catch((e) => console.error("Learning failed:", e));
    // 更新任务执行统计
    TaskRepo.updateExecution(taskId, modelResponse.input_tokens + modelResponse.output_tokens).catch((e) => console.error("Failed to update task:", e));

    // 写 trace：classification + response
    TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "classification",
      detail: { intent: features.intent, complexity_score: features.complexity_score, mode },
    }).catch((e) => console.error("Failed to write classification trace:", e));
    TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "routing",
      detail: { selected_model: routing.selected_model, selected_role: routing.selected_role, confidence: routing.confidence, did_fallback: didFallback },
    }).catch((e) => console.error("Failed to write routing trace:", e));
    TaskRepo.createTrace({
      id: uuid(), task_id: taskId, type: "response",
      detail: { input_tokens: modelResponse.input_tokens, output_tokens: modelResponse.output_tokens, latency_ms: latencyMs, total_cost_usd: totalCost },
    }).catch((e) => console.error("Failed to write response trace:", e));

    const response: ChatResponse = {
      message: modelResponse.content,
      decision: { ...decision, execution: { ...decision.execution, response_text: "" } },
    };
    return c.json(response);
  } catch (error: any) {
    console.error("Chat error:", error);
    return c.json({ error: error.message }, 500);
  }
});

chatRouter.post("/feedback", async (c) => {
  const { decision_id, feedback_type } = await c.req.json();
  const { recordFeedback } = await import("../evolution/feedback-collector.js");
  await recordFeedback(decision_id, feedback_type);
  return c.json({ success: true });
});

export { chatRouter };
