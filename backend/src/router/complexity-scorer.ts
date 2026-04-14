import type { IntentType, ChatMessage } from "../types/index.js";

interface ComplexityFactors {
  length_score: number;
  intent_score: number;
  depth_score: number;
  specificity_score: number;
  multi_step_score: number;
}

const INTENT_BASE_COMPLEXITY: Record<IntentType, number> = {
  chat: 5, simple_qa: 15, translation: 25, summarization: 35,
  creative: 50, code: 60, reasoning: 70, math: 75, unknown: 40,
};

export function scoreComplexity(query: string, intent: IntentType, history: ChatMessage[]): { score: number; factors: ComplexityFactors } {
  const safeQuery = query ?? "";
  const wordCount = safeQuery.split(/\s+/).length;
  const length_score = Math.min(20, Math.round(wordCount / 5));
  const intent_score = Math.round(INTENT_BASE_COMPLEXITY[intent] * 0.3);
  const conversationDepth = history.filter((m) => m.role === "user").length;
  const depth_score = Math.min(20, conversationDepth * 3);

  let specificity_score = 0;
  if (/\d{3,}/.test(query)) specificity_score += 5;
  if (/["「『].*["」』]/.test(query)) specificity_score += 3;
  if (/https?:\/\//.test(query)) specificity_score += 5;
  if (query.length > 500) specificity_score += 5;
  specificity_score = Math.min(15, specificity_score);

  let multi_step_score = 0;
  const stepIndicators = query.match(/首先|然后|接着|最后|第[一二三四五]|step|1\.|2\.|3\.|并且|同时|另外|还有/gi);
  if (stepIndicators) multi_step_score = Math.min(15, stepIndicators.length * 5);

  // 新增：分析总结类词汇
  const analysisTerms = query.match(/总结|概括|提炼|分析|比较|优缺点|区别|差异|原因|为什么|如何理解/gi);
  if (analysisTerms) multi_step_score += Math.min(10, analysisTerms.length * 4);

  // 新增：结构化输出要求
  const structuredTerms = query.match(/按.*格式|表格|分点|详细|完整|逐步|示例|注意事项|不少于|至少|保留.*术语|保持.*风格/gi);
  if (structuredTerms) specificity_score += Math.min(10, structuredTerms.length * 3);

  // 新增：长文本额外加分
  if (safeQuery.length > 120) specificity_score += 5;
  if (safeQuery.length > 300) specificity_score += 5;

  const score = Math.min(100, length_score + intent_score + depth_score + specificity_score + multi_step_score);

  return { score, factors: { length_score, intent_score, depth_score, specificity_score, multi_step_score } };
}
