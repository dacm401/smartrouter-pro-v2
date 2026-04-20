import type { InputFeatures } from "../types/index.js";

export interface QualityCheckResult {
  passed: boolean;
  score: number;
  issues: string[];
}

export function checkQuality(response: string, features: InputFeatures): QualityCheckResult {
  // chat 和 simple_qa 不走 quality gate，直接通过
  // 原因：这两类问题的"正确答案"就是短回复，不应该被质量门拦截
  if (features.intent === "chat" || features.intent === "simple_qa") {
    return { passed: true, score: 100, issues: [] };
  }

  // 新增：unknown intent + 短输入（< 30字）→ 也直接通过
  // 原因：短消息大概率是闲聊，LLM classifier 失败降级到 unknown 时不应触发 fallback
  if (features.intent === "unknown" && features.token_count < 30) {
    return { passed: true, score: 100, issues: [] };
  }

  const issues: string[] = [];
  let score = 100;

  if (response.length < 10) {
    score -= 40;
    issues.push("响应过短");
  } else if (features.complexity_score > 50 && response.length < 100) {
    score -= 20;
    issues.push("复杂问题但响应较短");
  }

  const lowConfidencePatterns = [/我不太确定/,/我不确定/,/可能是/,/也许/,/I'm not sure/i,/I don't know/i,/I cannot/i];
  const lowConfidenceCount = lowConfidencePatterns.filter((p) => p.test(response)).length;
  if (lowConfidenceCount >= 2) { score -= 25; issues.push("多处低置信表达"); }

  if (response.endsWith("...") || response.endsWith("…") || (response.length > 200 && !response.match(/[。！？.!?\n]$/))) {
    score -= 15;
    issues.push("可能被截断");
  }

  if (features.has_code || features.intent === "code") {
    if (!response.includes("```") && !response.includes("    ")) {
      score -= 15;
      issues.push("代码问题但无代码块");
    }
  }

  const sentences = response.split(/[。.!！?？\n]+/).filter((s) => s.length > 10);
  const uniqueSentences = new Set(sentences.map((s) => s.trim()));
  if (sentences.length > 3 && uniqueSentences.size < sentences.length * 0.7) {
    score -= 20;
    issues.push("存在重复内容");
  }

  return { passed: score >= 60, score: Math.max(0, score), issues };
}
