// 美元 / 百万 token（来源：OpenAI / SiliconFlow / Anthropic 公开定价）
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o":                           { input: 5.0,    output: 15.0   },
  "gpt-4o-mini":                      { input: 0.15,   output: 0.6    },
  "gpt-3.5-turbo":                    { input: 0.5,    output: 1.5    },
  // Anthropic
  "claude-3-5-sonnet-20241022":       { input: 3.0,    output: 15.0   },
  "claude-3-haiku-20240307":          { input: 0.25,   output: 1.25  },
  // SiliconFlow / DeepSeek / Qwen
  "deepseek-ai/DeepSeek-V3":          { input: 0.27,   output: 1.1    },
  "deepseek-ai/DeepSeek-R1":          { input: 0.55,   output: 2.19  },
  "Qwen/Qwen2.5-7B-Instruct":         { input: 0.5,    output: 1.0    },
  "Qwen/Qwen2.5-72B-Instruct":        { input: 0.4,    output: 0.4    },
};

// 基准模型：用于计算"如果全走最强模型"的理论成本
export const BASELINE_MODEL = "gpt-4o";
export const BASELINE_PRICING = MODEL_PRICING[BASELINE_MODEL];

// 计算单次调用的理论基准成本（美元）
export function calcBaselineCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * BASELINE_PRICING.input + outputTokens * BASELINE_PRICING.output) /
    1_000_000
  );
}

// 计算单次调用的实际成本（美元）
// 若模型不在价格表中，回退到数据库记录的 total_cost_usd
export function calcActualCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  fallbackCostUsd: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return fallbackCostUsd;
  return (
    (inputTokens * pricing.input + outputTokens * pricing.output) /
    1_000_000
  );
}
