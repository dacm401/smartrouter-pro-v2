/**
 * PromptAssembler v2 — 人格化 System Prompt
 *
 * 支持 Fast/Slow 两种模式的人格化 prompt 构建
 */

import type { IntentType } from "../types/index.js";
import { countTokens } from "../models/token-counter.js";

export type PromptMode = "direct" | "research";
export type ModelMode = "fast" | "slow";

export interface PromptAssemblyInput {
  mode: PromptMode;
  modelMode: ModelMode;
  intent: IntentType;
  userMessage: string;
  memoryText?: string;
  taskSummary?: {
    goal?: string | null;
    summaryText?: string | null;
    nextStep?: string | null;
  };
  maxTaskSummaryTokens?: number;
  lang?: "zh" | "en";
}

export interface PromptSections {
  core_rules: string;
  mode_policy: string;
  task_summary?: string;
  user_request: string;
}

export interface PromptAssemblyOutput {
  systemPrompt: string;
  userPrompt: string;
  sections: PromptSections;
}

// ── Fast Model: 闲聊/简单问答模式 ─────────────────────────────────────────────

function buildFastSystemPrompt(intent: IntentType, memoryText: string, lang: "zh" | "en"): string {
  const persona = lang === "zh" ? `你是用户的 AI 助手，说话自然、简洁，像朋友一样。

【核心原则】
- 闲聊和简单问题：1-2句话回答，口语化，不要列清单，不要废话
- 用户说"嗯""好""继续""然后呢"这类短句：自然接话，不要重新解释之前说过的内容
- 不要用"当然！""很高兴为您服务！""好的，我来帮您"这类开场白，直接回答
- 不要在每次回答结尾加"如果您还有其他问题，欢迎继续提问"
- 用户没说完整 → 简短追问一句，不要假设和脑补

【回答长度规范】
- 打招呼/情绪/闲聊 → 1句，带点温度
- 简单事实问题 → 1-2句，直接给答案
- 需要解释的问题 → 3-5句，不用标题和列表
- 只有明确要求"列出""总结""详细说明"时，才用列表格式` : `You are a helpful AI assistant. Be natural, concise, and friendly.

【Core Rules】
- For casual chat and simple questions: 1-2 sentences, conversational tone
- No filler phrases like "Of course!", "Great question!", "I'd be happy to help!"
- Don't add "Feel free to ask if you have more questions" at the end
- If the user's message is unclear, ask one short clarifying question`;

  const intentHint: Record<IntentType, string> = {
    chat: lang === "zh" ? "这是一条闲聊消息，用自然口语回应，1句话足够。" : "This is casual chat. Respond naturally in 1 sentence.",
    simple_qa: lang === "zh" ? "这是一个简单问题，直接给答案，不超过2句。" : "This is a simple factual question. Give a direct answer in 1-2 sentences.",
    translation: lang === "zh" ? "翻译任务，直接输出译文，不需要解释。" : "Translation task. Output the translation directly without explanation.",
    summarization: lang === "zh" ? "总结任务，提炼核心要点，简洁有力。" : "Summarization task. Extract key points concisely.",
    code: lang === "zh" ? "代码任务，给出可运行的代码，必要时简短说明。" : "Code task. Provide runnable code with brief explanation if needed.",
    math: lang === "zh" ? "数学问题，给出解题过程和答案。" : "Math problem. Show work and give the answer.",
    reasoning: lang === "zh" ? "分析问题，结构清晰，但不要过度展开。" : "Analysis task. Be structured but don't over-elaborate.",
    creative: lang === "zh" ? "创作任务，发挥创意，符合用户要求的风格和长度。" : "Creative task. Be creative and match the requested style and length.",
    research: lang === "zh" ? "研究类问题，给出有结构的分析，可以适当使用列表。" : "Research question. Provide structured analysis, lists are acceptable.",
    general: lang === "zh" ? "根据问题内容自然回应，不需要特别处理。" : "Respond naturally based on the content of the question.",
    unknown: lang === "zh" ? "根据问题性质判断合适的回答方式。" : "Respond appropriately based on the nature of the question.",
  };

  const memorySection = memoryText
    ? `\n【关于这个用户】\n${memoryText}\n`
    : "";

  return `${persona}${memorySection}\n【本次问题类型】${intentHint[intent] ?? intentHint.unknown}`;
}

// ── Slow Model: 深度分析模式 ─────────────────────────────────────────────────

function buildSlowSystemPrompt(intent: IntentType, memoryText: string, lang: "zh" | "en"): string {
  const persona = lang === "zh" ? `你是用户的 AI 助手，擅长深度分析和复杂问题。

【工作方式】
- 这个问题需要认真思考，你会给出有深度的回答
- 回答结构清晰，但不要为了结构而结构——如果一段话能说清楚，就不要拆成列表
- 可以适当展示推理过程，但不要"表演思考"——不要写"首先，让我来分析一下这个问题的各个维度..."
- 如果问题有多种解读，先确认用户的意图，再深入回答
- 给出结论时要明确，不要用"可能""也许""或许"来规避责任` : `You are a thoughtful AI assistant for complex analysis.

【Working Style】
- Give structured, in-depth answers
- Show reasoning when helpful, but don't perform thinking theatrically
- Be direct with conclusions — don't hedge everything with "maybe" and "perhaps"`;

  const intentHint: Record<IntentType, string> = {
    chat: lang === "zh" ? "即使是闲聊，也可以稍微深入一点，但不要变成演讲。" : "Even for casual chat, you can go slightly deeper, but don't lecture.",
    simple_qa: lang === "zh" ? "简单问题也可以给一些背景信息，但不要过度。" : "Simple questions can include some context, but don't overdo it.",
    translation: lang === "zh" ? "翻译时保留原文的语气和风格，必要时解释文化差异。" : "Preserve tone and style in translation; explain cultural differences if needed.",
    summarization: lang === "zh" ? "总结要抓住核心，同时保留关键细节。" : "Summarize the core while preserving key details.",
    code: lang === "zh" ? "代码要完整、可运行，解释设计思路。" : "Provide complete, runnable code and explain design decisions.",
    math: lang === "zh" ? "数学推导要清晰，每一步都有依据。" : "Show clear mathematical reasoning with justification for each step.",
    reasoning: lang === "zh" ? "深入分析，展示思考过程，给出明确结论。" : "Deep analysis showing reasoning process with clear conclusions.",
    creative: lang === "zh" ? "创作要有深度和独特性，不只是完成任务。" : "Create with depth and originality, not just fulfill the request.",
    research: lang === "zh" ? "研究类问题要系统、全面，有数据支撑更好。" : "Research questions should be systematic, comprehensive, data-backed when possible.",
    general: lang === "zh" ? "根据问题给出适当深度的回答，自然流畅。" : "Provide answers with appropriate depth, naturally and fluently.",
    unknown: lang === "zh" ? "根据问题复杂度给出适当的深度回答。" : "Respond with appropriate depth based on question complexity.",
  };

  const memorySection = memoryText
    ? `\n【关于这个用户】\n${memoryText}\n`
    : "";

  return `${persona}${memorySection}\n【本次问题类型】${intentHint[intent] ?? intentHint.unknown}`;
}

// ── Task Summary Section ─────────────────────────────────────────────────────

function buildTaskSummarySection(
  taskSummary: PromptAssemblyInput["taskSummary"],
  maxTokens?: number
): string | undefined {
  if (!taskSummary) return undefined;
  const { goal, summaryText, nextStep } = taskSummary;
  if (!goal && !summaryText && !nextStep) return undefined;

  const lines: string[] = ["Task context:"];
  if (goal) lines.push(`- Goal: ${goal}`);
  if (summaryText) lines.push(`- Summary: ${summaryText}`);
  if (nextStep) lines.push(`- Next step: ${nextStep}`);
  let section = lines.join("\n");

  // Token budget enforcement (MC-003)
  if (maxTokens && maxTokens > 0) {
    const sectionTokens = countTokens(section);
    if (sectionTokens > maxTokens) {
      const excessTokens = sectionTokens - maxTokens;
      const charsToRemove = Math.ceil((excessTokens / sectionTokens) * section.length);
      if (summaryText && summaryText.length > charsToRemove) {
        const trimmed = summaryText.slice(0, summaryText.length - charsToRemove);
        const lastNewline = trimmed.lastIndexOf("\n");
        const cutoff = lastNewline > 0 ? lastNewline : trimmed.length;
        const newSummaryText = trimmed.slice(0, cutoff);
        const newLines: string[] = ["Task context:"];
        if (goal) newLines.push(`- Goal: ${goal}`);
        if (newSummaryText) newLines.push(`- Summary: ${newSummaryText}[...truncated]`);
        section = newLines.join("\n");
      }
    }
  }

  return section;
}

// ── Main Assembler ───────────────────────────────────────────────────────────

export function assemblePrompt(input: PromptAssemblyInput): PromptAssemblyOutput {
  const {
    mode,
    modelMode,
    intent,
    userMessage,
    memoryText = "",
    taskSummary,
    maxTaskSummaryTokens,
    lang = "zh",
  } = input;

  // 根据 modelMode 选择对应的 system prompt builder
  const systemPrompt = modelMode === "fast"
    ? buildFastSystemPrompt(intent, memoryText, lang)
    : buildSlowSystemPrompt(intent, memoryText, lang);

  const taskSummarySection = buildTaskSummarySection(taskSummary, maxTaskSummaryTokens);

  const sections: PromptSections = {
    core_rules: systemPrompt,
    mode_policy: mode === "direct" ? "Mode: direct" : "Mode: research",
    user_request: userMessage,
  };

  if (taskSummarySection) {
    sections.task_summary = taskSummarySection;
  }

  // Assemble final system prompt
  const systemParts: string[] = [sections.core_rules, sections.mode_policy];
  if (sections.task_summary) {
    systemParts.push(sections.task_summary);
  }
  const finalSystemPrompt = systemParts.join("\n\n");

  return {
    systemPrompt: finalSystemPrompt,
    userPrompt: userMessage,
    sections,
  };
}
