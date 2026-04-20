// Phase 3.0: Manager-Worker Runtime — ManagerDecision 校验
// backend/src/orchestrator/decision-validator.ts
//
// 用 zod（已安装）替代 ajv，运行时校验 Fast Manager 输出的 ManagerDecision。

import { z } from "zod";
import type { ManagerDecision, ManagerDecisionType, RoutingLayer } from "../types/index.js";

// ── 子 Schema ──────────────────────────────────────────────────────────────────

const ClarifyOptionSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(100).optional(),  // Manager 可省略
});

const ClarificationSchema = z.object({
  question_id: z.string().min(1).max(100).optional(),  // Manager 可省略
  question_text: z.string().min(1).max(500),
  options: z.array(ClarifyOptionSchema).max(10).optional(),
  allow_free_text: z.boolean().optional(),
  clarification_reason: z.string().min(1).max(300).optional(),  // Manager 可省略
  missing_fields: z.array(z.string()).max(20).optional(),
});

const DirectResponseSchema = z.object({
  style: z.enum(["concise", "natural", "structured"]).optional(),  // Manager 可省略，默认 natural
  content: z.string().min(1).max(2000),
  max_tokens_hint: z.number().int().min(1).max(2000).optional(),
});

const RequiredOutputSchema = z.object({
  format: z.enum(["structured_analysis", "bullet_summary", "answer", "json"]),
  sections: z.array(z.string()).max(20).optional(),
  must_include: z.array(z.string()).max(20).optional(),
  max_points: z.number().int().min(1).max(20).optional(),
  tone: z.enum(["neutral", "professional", "concise"]).optional(),
});

const InputMaterialSchema = z.object({
  type: z.enum(["user_query", "excerpt", "evidence_ref", "memory_ref", "archive_fact"]),
  content: z.string().max(4000).optional(),
  ref_id: z.string().max(100).optional(),
  title: z.string().max(200).optional(),
  importance: z.number().min(0).max(1).optional(),
});

const CommandSchema = z.object({
  command_type: z.enum(["delegate_analysis", "delegate_summarization", "execute_plan", "execute_research"]).optional(),  // Manager 可省略
  task_type: z.string().min(1).max(100).optional(),  // Manager 可省略，默认 analysis
  task_brief: z.string().min(1).max(4000),
  goal: z.string().min(1).max(1000).optional(),  // Manager 可省略，默认等于 task_brief
  constraints: z.array(z.string().max(300)).max(20).optional(),
  input_materials: z.array(InputMaterialSchema).max(30).optional(),
  required_output: RequiredOutputSchema.optional(),
  tools_allowed: z.array(z.string()).max(20).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  timeout_sec: z.number().int().min(1).max(3600).optional(),
  worker_hint: z.enum(["slow_analyst", "execute_worker", "search_worker"]).optional(),
});

// ── 顶层 ManagerDecision Schema ────────────────────────────────────────────────

const ManagerDecisionSchema = z
  .object({
    schema_version: z.literal("manager_decision_v1"),
    decision_type: z.enum(["direct_answer", "ask_clarification", "delegate_to_slow", "execute_task"]),
    routing_layer: z.enum(["L0", "L1", "L2", "L3"]).optional(),  // 默认 L0，Manager 可省略
    reason: z.string().min(1).max(300),
    confidence: z.number().min(0).max(1),
    needs_archive: z.boolean().optional(),  // 默认 true，Manager 可省略
    direct_response: DirectResponseSchema.optional(),
    clarification: ClarificationSchema.optional(),
    command: CommandSchema.optional(),
  })
  .strict()
  // 条件必填约束（zod 3.80+ 支持 .refine()）
  .refine(
    (data) => {
      if (data.decision_type === "direct_answer") return !!data.direct_response;
      return true;
    },
    { message: "decision_type=direct_answer requires direct_response", path: ["direct_response"] }
  )
  .refine(
    (data) => {
      if (data.decision_type === "ask_clarification") return !!data.clarification;
      return true;
    },
    { message: "decision_type=ask_clarification requires clarification", path: ["clarification"] }
  )
  .refine(
    (data) => {
      if (["delegate_to_slow", "execute_task"].includes(data.decision_type)) return !!data.command;
      return true;
    },
    { message: "decision_type=delegate_to_slow|execute_task requires command", path: ["command"] }
  );

// ── 公开 API ──────────────────────────────────────────────────────────────────

/**
 * 解析 Fast Manager 原始输出，校验为 ManagerDecision。
 * 不合法时返回 null，触发旧 router fallback。
 */
export function validateManagerDecision(
  raw: unknown
): ManagerDecision | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schema_version !== "manager_decision_v1") return null;
  const result = ManagerDecisionSchema.safeParse(obj);
  if (!result.success) {
    console.warn("[ManagerDecision] validation failed:", result.error.message);
    return null;
  }
  return result.data;
}

/**
 * 语义补充校验（在结构校验后执行）。
 * 自动补全默认值，不返回 false。
 */
export function validateManagerDecisionSemantic(
  decision: ManagerDecision
): ManagerDecision {
  // routing_layer 默认 L0
  if (!decision.routing_layer) {
    decision.routing_layer = "L0";
  }
  // needs_archive 默认 true
  if (decision.needs_archive === undefined) {
    decision.needs_archive = true;
  }
  // command 字段默认值
  if (decision.command) {
    if (!decision.command.command_type) {
      decision.command.command_type = decision.decision_type === "execute_task"
        ? "execute_plan"
        : "delegate_analysis";
    }
    if (!decision.command.task_type) {
      decision.command.task_type = "analysis";
    }
    if (!decision.command.goal) {
      decision.command.goal = decision.command.task_brief;
    }
    // delegate_to_slow 默认 worker_hint = slow_analyst
    if (
      decision.decision_type === "delegate_to_slow" &&
      !decision.command.worker_hint
    ) {
      decision.command.worker_hint = "slow_analyst";
    }
  }
  // execute_task 至少需要 tools_allowed（不在 schema 层强制，由语义层提醒）
  if (decision.decision_type === "execute_task" && decision.command) {
    if (!decision.command.tools_allowed?.length) {
      console.warn("[ManagerDecision] execute_task: tools_allowed is recommended");
    }
  }
  return decision;
}

/**
 * 解析纯文本输出中的 ManagerDecision JSON。
 * Phase 0 使用：正则找 ```json``` 块或裸 JSON。
 * Phase 1+：改用 function calling，此函数降级为 fallback。
 */
export function parseManagerDecisionFromText(text: string): unknown {
  const match =
    text.match(/```json\s*([\s\S]*?)\s*```/)?.[1] ??
    text.match(/```\s*([\s\S]*?)\s*```/)?.[1] ??
    text.match(/(\{[\s\S]*\})/)?.[1];
  if (!match) return null;
  try {
    return JSON.parse(match.trim());
  } catch {
    return null;
  }
}

/**
 * 组合校验：先解析文本，再结构校验，最后语义补全。
 * Phase 0 主要入口。
 */
export function parseAndValidate(text: string): ManagerDecision | null {
  const raw = parseManagerDecisionFromText(text);
  if (!raw) return null;
  const validated = validateManagerDecision(raw);
  if (!validated) return null;
  return validateManagerDecisionSemantic(validated);
}
