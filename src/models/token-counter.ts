// 简化的 Token 计数器
export function countTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars / 4);
}

export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    "gpt-4o": { input: 0.0025, output: 0.01 },
    "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
    "claude-3-5-haiku-20241022": { input: 0.0008, output: 0.004 },
  };
  const p = pricing[model] || pricing["gpt-4o-mini"];
  return (inputTokens / 1000) * p.input + (outputTokens / 1000) * p.output;
}
