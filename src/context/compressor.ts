import type { ChatMessage, CompressionLevel, CompressionDetail } from "../types/index.js";
import { countTokens } from "../models/token-counter.js";
import { callModel } from "../models/model-gateway.js";
import { config } from "../config.js";

export interface CompressionResult {
  messages: ChatMessage[]; details: CompressionDetail[];
  original_tokens: number; compressed_tokens: number;
}

export async function compressHistory(history: ChatMessage[], level: CompressionLevel, budgetTokens: number): Promise<CompressionResult> {
  const original_tokens = history.reduce((sum, m) => sum + countTokens(m.content), 0);

  if (level === "L0" || history.length <= 2) {
    return {
      messages: history,
      details: history.map((m, i) => ({ turn_index: i, role: m.role as "user" | "assistant", action: "kept" as const, original_tokens: countTokens(m.content), compressed_tokens: countTokens(m.content) })),
      original_tokens, compressed_tokens: original_tokens,
    };
  }

  switch (level) {
    case "L1": return compressL1(history, original_tokens);
    case "L2": return compressL2(history, original_tokens, budgetTokens);
    case "L3": return compressL3(history, original_tokens, budgetTokens);
    default: return { messages: history, details: [], original_tokens, compressed_tokens: original_tokens };
  }
}

async function compressL1(history: ChatMessage[], original_tokens: number): Promise<CompressionResult> {
  const details: CompressionDetail[] = [];
  const messages: ChatMessage[] = [];
  const REDUNDANT_PATTERNS = [/^(好的|明白了|没问题|OK|ok|嗯|收到|了解)/i, /^(Sure|Got it|Understood|Of course|No problem)/i];

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    const origTokens = countTokens(msg.content);
    const isRedundant = REDUNDANT_PATTERNS.some((p) => p.test(msg.content.trim()));

    if (isRedundant && i < history.length - 2) {
      details.push({ turn_index: i, role: msg.role as "user" | "assistant", action: "removed", original_tokens: origTokens, compressed_tokens: 0 });
      continue;
    }

    let content = msg.content;
    if (msg.role === "assistant") {
      content = content.replace(/^(当然[可以了]?[！!。.]?\s*|好的[，,]\s*|没问题[，,]\s*)/, "").replace(/\n*(希望[这对你]*有[所帮助]*[！!。.]?\s*|如果[你还]*有[其他任何]*问题.*$)/, "").trim();
    }

    const compressedTokens = countTokens(content);
    messages.push({ role: msg.role, content, metadata: { tokens: compressedTokens, compressed: compressedTokens < origTokens } });
    details.push({ turn_index: i, role: msg.role as "user" | "assistant", action: compressedTokens < origTokens ? "summarized" : "kept", original_tokens: origTokens, compressed_tokens: compressedTokens });
  }

  const compressed_tokens = messages.reduce((sum, m) => sum + countTokens(m.content), 0);
  return { messages, details, original_tokens, compressed_tokens };
}

async function compressL2(history: ChatMessage[], original_tokens: number, budgetTokens: number): Promise<CompressionResult> {
  const details: CompressionDetail[] = [];
  const messages: ChatMessage[] = [];
  const keepRecent = 6;
  const recentStart = Math.max(0, history.length - keepRecent);
  const earlyMessages = history.slice(0, recentStart);
  const recentMessages = history.slice(recentStart);

  if (earlyMessages.length > 0) {
    const conversationText = earlyMessages.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`).join("\n");
    try {
      const summaryResponse = await callModel(config.compressorModel, [
        { role: "system", content: "你是一个对话摘要专家。请将以下对话压缩为简洁摘要，保留关键实体、用户需求、已达成结论。输出2-3句话，不超过150字。" },
        { role: "user", content: conversationText },
      ]);
      const summary = `[对话摘要] ${summaryResponse}`;
      const summaryTokens = countTokens(summary);
      messages.push({ role: "system", content: summary, metadata: { tokens: summaryTokens, compressed: true } });
      for (let i = 0; i < earlyMessages.length; i++) {
        details.push({ turn_index: i, role: earlyMessages[i].role as "user" | "assistant", action: "summarized", original_tokens: countTokens(earlyMessages[i].content), compressed_tokens: Math.round(summaryTokens / earlyMessages.length), summary: i === 0 ? summary : undefined });
      }
    } catch {
      for (const msg of earlyMessages) {
        messages.push(msg);
        details.push({ turn_index: details.length, role: msg.role as "user" | "assistant", action: "kept", original_tokens: countTokens(msg.content), compressed_tokens: countTokens(msg.content) });
      }
    }
  }

  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i];
    messages.push(msg);
    details.push({ turn_index: recentStart + i, role: msg.role as "user" | "assistant", action: "kept", original_tokens: countTokens(msg.content), compressed_tokens: countTokens(msg.content) });
  }

  const compressed_tokens = messages.reduce((sum, m) => sum + countTokens(m.content), 0);
  return { messages, details, original_tokens, compressed_tokens };
}

async function compressL3(history: ChatMessage[], original_tokens: number, budgetTokens: number): Promise<CompressionResult> {
  const conversationText = history.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`).join("\n");
  try {
    const structuredResponse = await callModel(config.compressorModel, [
      { role: "system", content: `将以下对话提取为JSON格式：\n{"topic":"对话主题","key_facts":["关键事实1","关键事实2"],"user_preferences":["用户偏好1"],"decisions_made":["已做决策1"],"open_questions":["未解决问题1"]}\n只输出JSON。` },
      { role: "user", content: conversationText },
    ]);
    const structured = `[结构化上下文] ${structuredResponse}`;
    const structuredTokens = countTokens(structured);
    const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
    const lastAssistantMsg = [...history].reverse().find((m) => m.role === "assistant");
    const messages: ChatMessage[] = [{ role: "system", content: structured, metadata: { tokens: structuredTokens, compressed: true } }];
    if (lastUserMsg) messages.push(lastUserMsg);
    if (lastAssistantMsg) messages.push(lastAssistantMsg);
    const details: CompressionDetail[] = history.map((h, i) => ({ turn_index: i, role: h.role as "user" | "assistant", action: "structured", original_tokens: countTokens(h.content), compressed_tokens: Math.round(structuredTokens / history.length) }));
    const compressed_tokens = messages.reduce((sum, m) => sum + countTokens(m.content), 0);
    return { messages, details, original_tokens, compressed_tokens };
  } catch { return compressL2(history, original_tokens, budgetTokens); }
}

export function autoSelectCompressionLevel(historyTokens: number, budgetTokens: number): CompressionLevel {
  const ratio = historyTokens / budgetTokens;
  if (ratio <= 1.0) return "L0";
  if (ratio <= 1.5) return "L1";
  if (ratio <= 3.0) return "L2";
  return "L3";
}
