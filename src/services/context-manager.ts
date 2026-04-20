import type { ChatRequest, ChatMessage, ContextResult, CompressionLevel } from "../types/index.js";
import { calculateBudget, needsCompression } from "../context/token-budget.js";
import { compressHistory, autoSelectCompressionLevel } from "../context/compressor.js";
import { countTokens } from "../models/token-counter.js";

/** Fallback system prompt used when no external prompt is provided. */
const DEFAULT_SYSTEM_PROMPT = `You are SmartRouter Pro, an intelligent AI assistant. Respond accurately and helpfully. Format responses clearly. The conversation may include compressed history summaries — use them naturally as context.`;

export async function manageContext(
  request: ChatRequest,
  selectedModel: string,
  systemPrompt?: string
): Promise<ContextResult> {
  const budget = calculateBudget(selectedModel);
  const history = request.history || [];
  const originalTokens = history.reduce((sum, m) => sum + countTokens(m.content), 0);

  let compressionLevel: CompressionLevel = request.preferences?.compression_level || "L0";
  if (compressionLevel === "L0" && needsCompression(history, budget)) {
    compressionLevel = autoSelectCompressionLevel(originalTokens, budget.available_for_history);
  }

  const compressionResult = await compressHistory(history, compressionLevel, budget.available_for_history);

  const finalMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    ...compressionResult.messages,
    { role: "user", content: request.message },
  ];

  const compressedTokens = finalMessages.reduce((sum, m) => sum + countTokens(m.content), 0);

  return {
    original_tokens: originalTokens + countTokens(request.message),
    compressed_tokens: compressedTokens,
    compression_level: compressionLevel,
    compression_ratio: originalTokens > 0 ? Math.round((1 - compressionResult.compressed_tokens / originalTokens) * 100) / 100 : 0,
    memory_items_retrieved: 0,
    final_messages: finalMessages,
    compression_details: compressionResult.details,
  };
}
