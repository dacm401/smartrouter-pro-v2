import type { ChatRequest, InputFeatures, RoutingDecision } from "../types/index.js";
import { countTokens } from "../models/token-counter.js";

export async function analyzeAndRoute(request: ChatRequest): Promise<{ features: InputFeatures }> {
  const { message, history = [] } = request;

  const tokenCount = countTokens(message);
  const contextTokens = history.reduce((sum, m) => sum + countTokens(m.content), 0);

  // LLM-native routing: the model self-judges via system prompt (see orchestrator.ts)
  // This module provides lightweight feature extraction for any downstream use.
  const features: InputFeatures = {
    raw_query: message,
    token_count: tokenCount,
    context_token_count: contextTokens,
    conversation_depth: history.filter((m) => m.role === "user").length,
    language: detectLanguage(message),
    // Legacy fields kept for type compatibility; no longer used by routing logic
    intent: "general",
    complexity_score: 50,
    has_code: false,
    has_math: false,
    requires_reasoning: false,
  };

  return { features };
}

export function getDefaultRouting(): RoutingDecision {
  return {
    router_version: "llm_native_v0.4",
    scores: { fast: 0, slow: 0 },
    confidence: 0,
    selected_model: "",
    selected_role: "fast",
    selection_reason: "llm_native_routing",
    fallback_model: "",
  };
}

function detectLanguage(text: string): string {
  const safeText = text ?? "";
  const chineseChars = safeText.match(/[\u4e00-\u9fff]/g);
  if (chineseChars && chineseChars.length > safeText.length * 0.1) return "zh";
  return "en";
}
