import { config } from "../config.js";
import type { ChatMessage } from "../types/index.js";
import { countTokens } from "../models/token-counter.js";

const MODEL_MAX_TOKENS: Record<string, number> = {
  "gpt-4o-mini": 128000, "gpt-4o": 128000,
  "claude-3-5-sonnet-20241022": 200000, "claude-3-5-haiku-20241022": 200000,
};

export interface TokenBudget {
  total: number; system_prompt: number; memory: number;
  history: number; input: number; output_reserve: number; available_for_history: number;
}

export function calculateBudget(model: string): TokenBudget {
  const maxTokens = MODEL_MAX_TOKENS[model] || 128000;
  const total = Math.floor(maxTokens * 0.85);
  return {
    total, system_prompt: Math.floor(total * config.tokenBudget.systemPromptRatio),
    memory: Math.floor(total * config.tokenBudget.memoryRatio),
    history: Math.floor(total * config.tokenBudget.historyRatio),
    input: Math.floor(total * config.tokenBudget.inputRatio),
    output_reserve: Math.floor(total * config.tokenBudget.outputReserveRatio),
    available_for_history: Math.floor(total * config.tokenBudget.historyRatio),
  };
}

export function needsCompression(history: ChatMessage[], budget: TokenBudget): boolean {
  const historyTokens = history.reduce((sum, m) => sum + countTokens(m.content), 0);
  return historyTokens > budget.available_for_history;
}
