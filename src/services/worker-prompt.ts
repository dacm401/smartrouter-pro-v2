/**
 * Worker Prompt — Phase 3.0 Worker 化核心
 * src/services/worker-prompt.ts
 *
 * 职责：
 * - 为 Worker（slow_worker / execute_worker）构建只读 minimal 上下文的 prompt
 * - Worker 只读：task_brief / goal / constraints / confirmed_facts / evidence / memory
 * - Worker 不读：full persona / 全量 history / 无关 memory
 * - Worker 输出：结构化 WorkerResult
 *
 * 与 prompt-assembler.ts 的区别：
 *   prompt-assembler.ts：Fast/Slow 路由 → 人格化 persona + intent hints
 *   worker-prompt.ts：Manager-Worker 路径 → 结构化 command → Worker 专注执行
 *
 * Phase 3.0 Sprint
 */

import type {
  CommandPayload,
  WorkerHint,
  RequiredOutput,
} from "../types/index.js";
import type { WorkerResult } from "../types/index.js";

// ── Worker System Prompt ────────────────────────────────────────────────────────

function buildWorkerSystemPrompt(
  workerHint: WorkerHint,
  lang: "zh" | "en"
): string {
  // 中文版
  const zhPrompt = `你是 SmartRouter Pro 的执行专家（${workerHint === "slow_analyst" ? "深度分析 Worker" : workerHint === "execute_worker" ? "任务执行 Worker" : "搜索 Worker"}）。

【你的职责】
- 只关注任务本身，不关心用户是谁或怎么说话
- 严格按照 Manager 提供的 command 执行，不要自行发挥范围
- 有疑问时，先尽力执行，实在无法判断再说明

【输出规则 — 必须严格遵守】
完成执行后，按以下 JSON 格式输出结果（用代码块包裹）：
\`\`\`json
{
  "schema_version": "worker_result_v1",
  "status": "completed",
  "summary": "本次执行的核心结论（50字以内）",
  "structured_result": {
    "answer": "直接回答内容（如果有）",
    "key_findings": ["关键发现1", "关键发现2"],
    "confidence": 0.9
  },
  "confidence": 0.9,
  "execution_details": {
    "steps_taken": ["步骤1", "步骤2"],
    "sources_used": ["来源1"],
    "errors_encountered": []
  }
}
\`\`\`

【状态说明】
- status: "completed"（成功完成）
- status: "partial"（部分完成，有限制或未达到预期）
- status: "failed"（执行失败，说明原因）
- status: "needs_clarification"（需要用户提供关键信息才能继续）

【约束】
- 不要在输出中加"以下是分析结果"这类废话
- 直接给出结果`;
  // 英文版
  const enPrompt = `You are SmartRouter Pro's execution specialist (${workerHint === "slow_analyst" ? "Deep Analysis Worker" : workerHint === "execute_worker" ? "Task Execution Worker" : "Search Worker"}).

【Your Role】
- Focus only on the task itself, not on who the user is or how to speak
- Execute strictly according to the Manager's command, do not expand scope
- If uncertain, attempt to execute first; only clarify if truly blocked

【Output Rules — MUST follow strictly】
After completing execution, output results in this JSON format (wrap in code block):
\`\`\`json
{
  "schema_version": "worker_result_v1",
  "status": "completed",
  "summary": "Core conclusion of this execution (within 50 characters)",
  "structured_result": {
    "answer": "Direct answer content (if applicable)",
    "key_findings": ["Finding 1", "Finding 2"],
    "confidence": 0.9
  },
  "confidence": 0.9,
  "execution_details": {
    "steps_taken": ["Step 1", "Step 2"],
    "sources_used": ["Source 1"],
    "errors_encountered": []
  }
}
\`\`\`

【Status Values】
- status: "completed" — Successfully completed
- status: "partial" — Partially completed with limitations
- status: "failed" — Execution failed, explain why
- status: "needs_clarification" — Requires user input to continue

【Constraints】
- Do not add filler like "Here are the analysis results"
- Output results directly`;

  return lang === "zh" ? zhPrompt : enPrompt;
}

// ── Output Format Guidance ─────────────────────────────────────────────────────

function buildOutputGuidance(
  requiredOutput: RequiredOutput | undefined,
  lang: "zh" | "en"
): string {
  if (!requiredOutput) {
    return lang === "zh"
      ? "\n【输出要求】按自然段落输出，简洁有力。"
      : "\n【Output Requirement】Output in natural paragraphs, concise and direct.";
  }

  const { format, sections, must_include, max_points, tone } = requiredOutput;
  const lines: string[] = [];

  lines.push(lang === "zh" ? "\n【输出要求】" : "\n【Output Requirement】");

  if (format) {
    const formatMap: Record<string, string> = {
      structured_analysis: lang === "zh" ? "结构化分析" : "Structured analysis",
      bullet_summary: lang === "zh" ? "要点列表" : "Bullet point summary",
      answer: lang === "zh" ? "直接回答" : "Direct answer",
      json: lang === "zh" ? "JSON 格式" : "JSON format",
    };
    lines.push(`- ${lang === "zh" ? "格式" : "Format"}: ${formatMap[format] ?? format}`);
  }

  if (sections?.length) {
    lines.push(
      `- ${lang === "zh" ? "包含章节" : "Include sections"}: ${sections.join(" / ")}`
    );
  }

  if (must_include?.length) {
    lines.push(
      `- ${lang === "zh" ? "必须包含" : "Must include"}: ${must_include.join(", ")}`
    );
  }

  if (max_points !== undefined) {
    lines.push(
      `- ${lang === "zh" ? "最多" : "Max"}: ${max_points} ${lang === "zh" ? "个要点" : "points"}`
    );
  }

  if (tone) {
    const toneMap: Record<string, string> = {
      neutral: lang === "zh" ? "中性" : "Neutral",
      professional: lang === "zh" ? "专业" : "Professional",
      concise: lang === "zh" ? "简洁" : "Concise",
    };
    lines.push(`- ${lang === "zh" ? "语气" : "Tone"}: ${toneMap[tone] ?? tone}`);
  }

  return lines.join("\n");
}

// ── Evidence Section ───────────────────────────────────────────────────────────

function buildEvidenceSection(
  confirmedFacts: string[],
  evidenceContent: string[],
  lang: "zh" | "en"
): string {
  const parts: string[] = [];

  if (confirmedFacts.length > 0) {
    const label = lang === "zh" ? "已确认事实" : "Confirmed Facts";
    parts.push(`\n${label}:\n${confirmedFacts.map((f) => `• ${f}`).join("\n")}`);
  }

  if (evidenceContent.length > 0) {
    const label = lang === "zh" ? "参考资料" : "Reference Materials";
    parts.push(`\n${label}:\n${evidenceContent.join("\n\n")}`);
  }

  return parts.join("\n");
}

// ── Main Assembler ────────────────────────────────────────────────────────────

export interface WorkerPromptInput {
  /** Manager 发来的结构化命令 */
  command: CommandPayload;
  /** 已确认的事实（从 archive 读取） */
  confirmedFacts?: string[];
  /** 证据内容（从 evidence 表读取） */
  evidenceContent?: string[];
  /** 相关记忆摘要（从 memory 读取，但只注入最相关的） */
  memorySummary?: string;
  /** 语言 */
  lang: "zh" | "en";
}

export interface WorkerPromptOutput {
  /** Worker 系统 prompt */
  systemPrompt: string;
  /** Worker 用户 prompt（任务上下文） */
  userPrompt: string;
  /** Worker 类型提示（用于日志/追踪） */
  workerHint: WorkerHint;
  /** 压缩比（原始输入 vs Worker 实际收到的） */
  compressionRatio: number;
}

export function buildWorkerPrompt(input: WorkerPromptInput): WorkerPromptOutput {
  const {
    command,
    confirmedFacts = [],
    evidenceContent = [],
    memorySummary,
    lang = "zh",
  } = input;

  const workerHint = command.worker_hint ?? "slow_analyst";
  const systemPrompt = buildWorkerSystemPrompt(workerHint, lang);

  // 构建 userPrompt — 纯任务上下文，不含 persona
  const sections: string[] = [];

  // 1. Goal
  sections.push(
    lang === "zh"
      ? `## 任务目标\n${command.goal}`
      : `## Task Goal\n${command.goal}`
  );

  // 2. Task Brief
  sections.push(
    lang === "zh"
      ? `## 任务摘要\n${command.task_brief}`
      : `## Task Brief\n${command.task_brief}`
  );

  // 3. Constraints
  if (command.constraints?.length) {
    sections.push(
      lang === "zh"
        ? `## 约束条件\n${command.constraints.map((c) => `• ${c}`).join("\n")}`
        : `## Constraints\n${command.constraints.map((c) => `• ${c}`).join("\n")}`
    );
  }

  // 4. Input Materials
  if (command.input_materials?.length) {
    const materialLines: string[] = [
      lang === "zh" ? "## 输入材料" : "## Input Materials",
    ];
    for (const mat of command.input_materials) {
      if (mat.content) {
        materialLines.push(
          `[${mat.type}] ${mat.title ? `${mat.title}: ` : ""}${mat.content}`
        );
      }
    }
    sections.push(materialLines.join("\n"));
  }

  // 5. Evidence + Confirmed Facts
  const evidenceSection = buildEvidenceSection(confirmedFacts, evidenceContent, lang);
  if (evidenceSection) {
    sections.push(evidenceSection);
  }

  // 6. Relevant Memory（只注入摘要，不注入完整记忆）
  if (memorySummary) {
    const label = lang === "zh" ? "相关背景" : "Relevant Context";
    sections.push(`${label}:\n${memorySummary}`);
  }

  // 7. Output Guidance
  sections.push(buildOutputGuidance(command.required_output, lang));

  const userPrompt = sections.join("\n\n");

  // 计算压缩比：原始输入 token 估算 vs Worker 实际收到的 token 估算
  const originalEstimate = (
    command.task_brief.length +
    command.goal.length +
    (command.constraints?.join("").length ?? 0) +
    (memorySummary?.length ?? 0)
  );
  const compressedEstimate = userPrompt.length + systemPrompt.length;
  const compressionRatio = compressedEstimate > 0
    ? Math.round((1 - compressedEstimate / Math.max(originalEstimate, 1)) * 100)
    : 0;

  return {
    systemPrompt,
    userPrompt,
    workerHint,
    compressionRatio,
  };
}

// ── Worker Result Parser ───────────────────────────────────────────────────────

import { z } from "zod";

const WorkerResultSchema = z.object({
  schema_version: z.literal("worker_result_v1"),
  status: z.enum(["completed", "partial", "failed", "needs_clarification"]),
  summary: z.string().max(500),
  structured_result: z
    .object({
      answer: z.string().optional(),
      key_findings: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  execution_details: z
    .object({
      steps_taken: z.array(z.string()).optional(),
      sources_used: z.array(z.string()).optional(),
      errors_encountered: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * 解析 Worker 输出的 JSON，校验合法性。
 * 不合法时返回 null 并记录原始输出。
 *
 * 注意：task_id 和 worker_type 需要调用方填充（来自 command 上下文）。
 * 本函数只解析 Worker 的原始输出。
 */
export function parseWorkerResult(
  rawOutput: string,
  taskId: string,
  workerHint: WorkerHint
): { result: WorkerResult; raw: string } | null {
  try {
    // 提取代码块中的 JSON
    const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawOutput.trim();
    const parsed = JSON.parse(jsonStr);

    const validated = WorkerResultSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn("[worker-prompt] WorkerResult parse failed:", validated.error.message);
      return null;
    }

    const data = validated.data;
    return {
      result: {
        task_id: taskId,
        worker_type: workerHint,
        status: data.status,
        summary: data.summary,
        structured_result: data.structured_result ?? {},
        confidence: data.confidence ?? 0.5,
        execution_details: data.execution_details,
      },
      raw: rawOutput,
    };
  } catch (e: any) {
    console.warn("[worker-prompt] WorkerResult parse error:", e.message);
    return null;
  }
}
